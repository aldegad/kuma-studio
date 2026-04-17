import fs, { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";

import { readJsonBody, sendJson } from "../server-support.mjs";
import { execGitSync } from "./git-command.mjs";
import { readProjectsRegistry } from "./project-defaults.mjs";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".venv",
  "__pycache__",
  ".next",
  ".turbo",
  "build",
  "coverage",
  ".cache",
]);
const EXPLORER_GLOBAL_ROOTS = {
  vault: resolve(join(homedir(), ".kuma", "vault")),
  claude: resolve(join(homedir(), ".claude")),
  codex: resolve(join(homedir(), ".codex")),
};
const PREVIEWABLE_BINARY_MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};
const PREVIEWABLE_BINARY_EXTENSIONS = new Set(Object.keys(PREVIEWABLE_BINARY_MIME_MAP));
const LANGUAGE_BY_EXTENSION = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".py": "python",
  ".sh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".sql": "sql",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".swift": "swift",
};

function isWithinRoot(root, candidatePath) {
  const relativePath = relative(root, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith(`${sep}..`));
}

function resolveConfiguredWorkspaceRoot(envValue = process.env.KUMA_STUDIO_WORKSPACE) {
  const configured = typeof envValue === "string" ? envValue.trim() : "";
  return resolve(configured || process.cwd());
}

function resolveConfiguredGlobalRoots(envValue = process.env.KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS) {
  const configuredIds = String(envValue || "")
    .replace(/\\+,/gu, ",")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (configuredIds.length === 0) {
    return {};
  }

  return configuredIds.reduce((roots, id) => {
    const root = EXPLORER_GLOBAL_ROOTS[id];
    if (root) {
      roots[id] = root;
    }
    return roots;
  }, {});
}

function resolveExplorerRootsConfig({ workspaceRoot, globalRoots, systemRoot, includeProjectRoots = true } = {}) {
  const defaultRoot = workspaceRoot ? resolve(workspaceRoot) : resolveConfiguredWorkspaceRoot();
  const resolvedSystemRoot = resolve(systemRoot ?? defaultRoot);
  const configuredGlobalRoots = Object.fromEntries(
    Object.entries(globalRoots ?? resolveConfiguredGlobalRoots()).map(([id, root]) => [id, resolve(root)]),
  );
  const configuredProjectRoots = includeProjectRoots
    ? Object.fromEntries(
      Object.entries(readProjectsRegistry())
        .map(([id, root]) => [id, resolve(root)]),
    )
    : {};
  const rootEntries = [
    { id: "workspace", path: defaultRoot },
    { id: "system", path: resolvedSystemRoot },
    ...Object.entries(configuredProjectRoots)
      .filter(([, root]) => resolve(root) !== defaultRoot && resolve(root) !== resolvedSystemRoot)
      .map(([id, root]) => ({ id, path: root })),
    ...Object.entries(configuredGlobalRoots)
      .filter(([, root]) => resolve(root) !== defaultRoot && resolve(root) !== resolvedSystemRoot)
      .map(([id, root]) => ({ id, path: root })),
  ];

  return {
    defaultRoot,
    systemRoot: resolvedSystemRoot,
    configuredGlobalRoots,
    configuredProjectRoots,
    rootEntries,
    allowedRoots: [...new Set(rootEntries.map((entry) => entry.path))],
  };
}

function resolveExplorerRootEntry(rootEntries, candidatePath) {
  const resolvedPath = resolve(candidatePath);
  return rootEntries.find((entry) => isWithinRoot(entry.path, resolvedPath)) ?? null;
}

function buildFilesystemChangePayload(rootEntries, candidatePath, eventType, origin) {
  const rootEntry = resolveExplorerRootEntry(rootEntries, candidatePath);
  if (!rootEntry) {
    return null;
  }

  const resolvedPath = resolve(candidatePath);
  const relativePath = relative(rootEntry.path, resolvedPath);
  return {
    rootId: rootEntry.id,
    rootPath: rootEntry.path,
    eventType,
    path: resolvedPath,
    relativePath: relativePath === "" ? "." : relativePath,
    origin,
    changedAt: new Date().toISOString(),
  };
}

async function buildFsTree(dirPath, maxDepth, currentDepth) {
  const name = basename(dirPath) || dirPath;
  const hidden = name.startsWith(".");
  const node = { name, path: dirPath, type: "dir", hidden };

  if (SKIP_DIRS.has(name) && currentDepth > 0) {
    node.expandable = false;
    return node;
  }

  if (currentDepth >= maxDepth) {
    node.expandable = true;
    node.children = [];
    return node;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
      const childPath = join(dirPath, entry.name);
      const childHidden = entry.name.startsWith(".");

      if (entry.isDirectory()) {
        children.push(await buildFsTree(childPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        const metadata = await stat(childPath).catch(() => null);
        children.push({
          name: entry.name,
          path: childPath,
          type: "file",
          hidden: childHidden,
          size: metadata ? metadata.size : undefined,
        });
      }
    }

    children.sort((left, right) => {
      if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

    node.children = children;
  } catch {
    node.children = [];
  }

  return node;
}

function parseGitStatus(output) {
  const files = {};
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2).trim();
    const filePath = line.slice(3).trim();
    let status = "modified";
    if (code === "??" || code === "A") status = "added";
    else if (code === "D") status = "deleted";
    else if (code === "R") status = "renamed";
    files[filePath] = status;
  }
  return files;
}

export function watchStudioExplorerRoots({
  workspaceRoot,
  globalRoots,
  systemRoot,
  studioWsEvents,
  debounceMs = 120,
  onError,
} = {}) {
  if (!studioWsEvents?.broadcastFilesystemChange) {
    return () => {};
  }

  const { rootEntries } = resolveExplorerRootsConfig({
    workspaceRoot,
    globalRoots,
    systemRoot,
    includeProjectRoots: false,
  });
  const watchers = [];
  const pendingChanges = new Map();
  let flushTimer = null;

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingChanges.size === 0) {
      return;
    }

    studioWsEvents.broadcastFilesystemChange({
      changes: [...pendingChanges.values()],
    });
    pendingChanges.clear();
  };

  const scheduleFlush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(flush, debounceMs);
  };

  for (const rootEntry of rootEntries) {
    if (!existsSync(rootEntry.path)) {
      continue;
    }

    const createPollingWatcher = () => {
      let previousEntries = new Set();
      try {
        previousEntries = new Set(fs.readdirSync(rootEntry.path));
      } catch {
        previousEntries = new Set();
      }

      const scanForChanges = () => {
        let nextEntries = new Set();
        try {
          nextEntries = new Set(fs.readdirSync(rootEntry.path));
        } catch {
          nextEntries = new Set();
        }

        const changedNames = new Set([
          ...[...nextEntries].filter((name) => !previousEntries.has(name)),
          ...[...previousEntries].filter((name) => !nextEntries.has(name)),
        ]);

        if (changedNames.size === 0) {
          handleWatchEvent("change");
        } else {
          for (const name of changedNames) {
            handleWatchEvent("rename", name);
          }
        }

        previousEntries = nextEntries;
      };

      const intervalId = setInterval(scanForChanges, Math.max(debounceMs, 80));
      return {
        close() {
          clearInterval(intervalId);
        },
      };
    };

    const handleWatchEvent = (eventType, filename) => {
      const candidatePath =
        typeof filename === "string" && filename.trim().length > 0
          ? resolve(rootEntry.path, filename)
          : rootEntry.path;
      const change = buildFilesystemChangePayload(rootEntries, candidatePath, eventType, "watch");
      if (!change) {
        return;
      }

      pendingChanges.set(`${change.rootId}:${change.path}:${change.eventType}`, change);
      scheduleFlush();
    };

    try {
      let watcher;
      try {
        watcher = fs.watch(rootEntry.path, { recursive: true }, handleWatchEvent);
      } catch (error) {
        try {
          watcher = fs.watch(rootEntry.path, handleWatchEvent);
        } catch {
          watcher = createPollingWatcher();
        }
        if (typeof onError === "function") {
          onError(error);
        } else {
          console.error("studio explorer watch failed:", error);
        }
      }

      if (typeof watcher.on === "function") {
        let fallbackWatcher = null;
        watcher.on("error", (error) => {
          if (!fallbackWatcher && error?.code === "EMFILE") {
            try {
              watcher.close?.();
            } catch {
              // ignore close failures before fallback
            }
            fallbackWatcher = createPollingWatcher();
            watchers.push(fallbackWatcher);
          }
          if (typeof onError === "function") {
            onError(error);
          } else {
            console.error("studio explorer watch failed:", error);
          }
        });
      }
      watchers.push(watcher);
    } catch (error) {
      if (typeof onError === "function") {
        onError(error);
      } else {
        console.error("studio explorer watch failed:", error);
      }
    }
  }

  return () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

export function createStudioExplorerRouteHandler({ workspaceRoot, globalRoots, systemRoot, studioWsEvents } = {}) {
  const {
    defaultRoot,
    systemRoot: resolvedSystemRoot,
    configuredGlobalRoots,
    configuredProjectRoots,
    rootEntries,
    allowedRoots,
  } = resolveExplorerRootsConfig({
    workspaceRoot,
    globalRoots,
    systemRoot,
  });

  function isAllowedPath(candidatePath) {
    const resolved = resolve(candidatePath);
    return allowedRoots.some((root) => isWithinRoot(root, resolved));
  }

  function broadcastFilesystemChange(candidatePath, eventType, origin) {
    const change = buildFilesystemChangePayload(rootEntries, candidatePath, eventType, origin);
    if (!change) {
      return;
    }
    studioWsEvents?.broadcastFilesystemChange({
      changes: [change],
    });
  }

  return async (req, res, url) => {
    if (url.pathname === "/studio/fs/roots" && req.method === "GET") {
      sendJson(res, 200, {
        workspaceRoot: defaultRoot,
        systemRoot: resolvedSystemRoot,
        projectRoots: configuredProjectRoots,
        globalRoots: configuredGlobalRoots,
      });
      return true;
    }

    if (url.pathname === "/studio/git/status" && req.method === "GET") {
      const root = url.searchParams.get("root") || defaultRoot;
      const resolvedRoot = resolve(root);
      if (!isAllowedPath(resolvedRoot)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const output = execGitSync("git status --porcelain -u", {
          cwd: resolvedRoot,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        });

        sendJson(res, 200, { root: resolvedRoot, files: parseGitStatus(output) });
      } catch {
        sendJson(res, 200, { root: resolvedRoot, files: {} });
      }
      return true;
    }

    if (url.pathname === "/studio/fs/tree" && req.method === "GET") {
      const root = url.searchParams.get("root") || defaultRoot;
      const depth = Math.min(Math.max(parseInt(url.searchParams.get("depth") || "2", 10) || 2, 1), 5);

      const resolvedRoot = resolve(root);
      if (!isAllowedPath(resolvedRoot)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const tree = await buildFsTree(resolvedRoot, depth, 0);
        sendJson(res, 200, tree);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read directory tree.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/fs/read" && req.method === "GET") {
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        sendJson(res, 400, { error: "Missing path parameter." });
        return true;
      }

      const resolved = resolve(filePath);
      if (!isAllowedPath(resolved)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const metadata = await stat(resolved);
        if (!metadata.isFile()) {
          sendJson(res, 400, { error: "Not a file." });
          return true;
        }

        const extension = extname(resolved).toLowerCase();
        if (PREVIEWABLE_BINARY_EXTENSIONS.has(extension)) {
          const buffer = await readFile(resolved);
          sendJson(res, 200, {
            content: buffer.toString("base64"),
            mimeType: PREVIEWABLE_BINARY_MIME_MAP[extension] || "application/octet-stream",
          });
          return true;
        }

        const buffer = await readFile(resolved);
        const sample = buffer.subarray(0, 8192);
        if (sample.includes(0)) {
          sendJson(res, 200, { binary: true, size: metadata.size });
          return true;
        }

        sendJson(res, 200, {
          content: buffer.toString("utf8"),
          language: LANGUAGE_BY_EXTENSION[extension] || "plaintext",
        });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read file.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/fs/delete" && req.method === "DELETE") {
      const body = await readJsonBody(req);
      const filePath = body?.path;
      if (!filePath) {
        sendJson(res, 400, { error: "Missing path parameter." });
        return true;
      }

      const resolved = resolve(filePath);
      if (!isAllowedPath(resolved)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const metadata = await stat(resolved);
        if (metadata.isDirectory()) {
          await rm(resolved, { recursive: true, force: false });
        } else if (metadata.isFile()) {
          await unlink(resolved);
        } else {
          sendJson(res, 400, { error: "Unsupported path type." });
          return true;
        }
        broadcastFilesystemChange(resolved, "delete", "route");
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to delete path.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/fs/write" && req.method === "PUT") {
      const body = await readJsonBody(req);
      const filePath = body?.path;
      const fileContent = body?.content;
      if (!filePath || typeof fileContent !== "string") {
        sendJson(res, 400, { error: "Missing path or content." });
        return true;
      }

      const resolved = resolve(filePath);
      if (!isAllowedPath(resolved)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        await writeFile(resolved, fileContent, "utf8");
        broadcastFilesystemChange(resolved, "change", "route");
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to write file.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    return false;
  };
}
