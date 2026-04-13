import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";

import { readJsonBody, sendJson } from "../server-support.mjs";
import { execGitSync } from "./git-command.mjs";

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
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
const IMAGE_MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
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

async function buildFsTree(dirPath, maxDepth, currentDepth) {
  const name = basename(dirPath) || dirPath;
  const hidden = name.startsWith(".");
  const node = { name, path: dirPath, type: "dir", hidden };

  if (SKIP_DIRS.has(name) && currentDepth > 0) {
    node.expandable = false;
    return node;
  }

  if (currentDepth >= maxDepth) {
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

export function createStudioExplorerRouteHandler({ workspaceRoot, globalRoots } = {}) {
  const defaultRoot = workspaceRoot ? resolve(workspaceRoot) : resolveConfiguredWorkspaceRoot();
  const configuredGlobalRoots = Object.fromEntries(
    Object.entries(globalRoots ?? resolveConfiguredGlobalRoots()).map(([id, root]) => [id, resolve(root)]),
  );
  const allowedRoots = [
    defaultRoot,
    ...Object.values(configuredGlobalRoots).filter((root) => resolve(root) !== defaultRoot),
  ];

  function isAllowedPath(candidatePath) {
    const resolved = resolve(candidatePath);
    return allowedRoots.some((root) => isWithinRoot(root, resolved));
  }

  return async (req, res, url) => {
    if (url.pathname === "/studio/fs/roots" && req.method === "GET") {
      sendJson(res, 200, {
        workspaceRoot: defaultRoot,
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
        if (IMAGE_EXTENSIONS.has(extension)) {
          const buffer = await readFile(resolved);
          sendJson(res, 200, {
            content: buffer.toString("base64"),
            mimeType: IMAGE_MIME_MAP[extension] || "application/octet-stream",
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
        if (!metadata.isFile()) {
          sendJson(res, 400, { error: "Not a file. Only file deletion is supported." });
          return true;
        }
        await unlink(resolved);
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to delete file.",
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
