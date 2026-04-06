/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats and office layout state.
 */

import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve, join, extname, basename, relative, isAbsolute } from "node:path";
import { readJsonBody, sendJson } from "../server-support.mjs";
import { readPlans } from "./plan-store.mjs";
import { listClaudePlans, deleteClaudePlan } from "./claude-plans-store.mjs";
import { filterTeamStatusSnapshot, toStudioTeamStatusSnapshot } from "./team-status-store.mjs";
import { createContentRouteHandler } from "./content-routes.mjs";
import { createExperimentRouteHandler } from "./experiment-routes.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isPathWithinRoot(rootPath, rootRealPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }

  const realCandidatePath = realpathSync(candidatePath);
  const realRelativePath = relative(rootRealPath, realCandidatePath);
  return !(realRelativePath.startsWith("..") || isAbsolute(realRelativePath));
}

function parseFrontmatter(content) {
  const text = String(content ?? "");
  if (!text.startsWith("---\n")) {
    return null;
  }

  const endIndex = text.indexOf("\n---", 4);
  if (endIndex === -1) {
    return null;
  }

  const block = text.slice(4, endIndex).trim();
  const fields = new Map();

  for (const line of block.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/u);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    fields.set(key, rawValue.trim().replace(/^['"]|['"]$/gu, ""));
  }

  return {
    fields,
    body: text.slice(endIndex + 4).trim(),
  };
}

export function extractStudioSkillDescription(content) {
  const frontmatter = parseFrontmatter(content);
  const frontmatterDescription = frontmatter?.fields.get("description");
  if (frontmatterDescription) {
    return frontmatterDescription;
  }

  const body = frontmatter?.body ?? String(content ?? "");
  const lines = body.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^#\s+/u.test(line.trim()));
  const candidateLines = (headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#+\s+/u.test(line));

  const firstSentence = candidateLines[0]?.match(/^(.+?[.!?])(?:\s|$)/u)?.[1] ?? candidateLines[0] ?? "";
  return firstSentence.trim();
}

async function readStudioSkills() {
  try {
    const skillsDir = join(homedir(), ".claude", "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      // Verify symlink target is a directory
      if (entry.isSymbolicLink()) {
        try {
          const s = await stat(join(skillsDir, entry.name));
          if (!s.isDirectory()) continue;
        } catch { continue; }
      }

      try {
        const skillDir = join(skillsDir, entry.name);
        const files = await readdir(skillDir);
        const skillFile = files.find((file) => file.toLowerCase() === "skill.md");

        if (!skillFile) continue;

        const content = await readFile(join(skillDir, skillFile), "utf8");

        skills.push({
          name: entry.name,
          description: extractStudioSkillDescription(content),
          file: skillFile,
          content,
          path: join(skillDir, skillFile),
        });
      } catch {
        continue;
      }
    }

    return skills;
  } catch {
    return [];
  }
}

async function readStudioPlugins() {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const content = await readFile(settingsPath, "utf8");
    const settings = JSON.parse(content);
    const plugins = settings.enabledPlugins;
    if (Array.isArray(plugins)) return plugins;
    if (plugins && typeof plugins === "object") return Object.keys(plugins).filter((k) => plugins[k]);
    return [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// File-system explorer helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".venv", "__pycache__", ".next", ".turbo", "build", "coverage", ".cache"]);
const fsWorkspaceRoot = resolve(process.env.KUMA_STUDIO_WORKSPACE || join(homedir(), "Documents", "workspace"));
const fsAllowedRoots = [
  fsWorkspaceRoot,
  resolve(join(homedir(), ".claude")),
  resolve(join(homedir(), ".codex")),
];

function isAllowedPath(candidatePath) {
  const resolved = resolve(candidatePath);
  return fsAllowedRoots.some((root) => resolved.startsWith(root));
}

async function buildFsTree(dirPath, maxDepth, currentDepth) {
  const name = basename(dirPath);
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
        const s = await stat(childPath).catch(() => null);
        children.push({
          name: entry.name,
          path: childPath,
          type: "file",
          hidden: childHidden,
          size: s ? s.size : undefined,
        });
      }
    }

    // Sort: dirs first, then files, alphabetical within each group
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    node.children = children;
  } catch {
    node.children = [];
  }

  return node;
}

/**
 * @param {object} options
 * @param {string} options.staticDir
 * @param {import("./stats-store.mjs").StatsStore} options.statsStore
 * @param {import("../scene-store.mjs").SceneStore} options.sceneStore
 * @param {import("./team-status-store.mjs").TeamStatusStore} [options.teamStatusStore]
 * @param {import("./content-store.mjs").ContentStore} [options.contentStore]
 * @param {import("./experiment-store.mjs").ExperimentStore} [options.experimentStore]
 * @param {ReturnType<import("./experiment-pipeline.mjs").createExperimentPipeline>} [options.experimentPipeline]
 * @param {string} [options.workspaceRoot]
 * @returns {(req: import("http").IncomingMessage, res: import("http").ServerResponse) => Promise<boolean>}
 */
export function createStudioRouteHandler({ staticDir, statsStore, sceneStore, agentStateManager, teamStatusStore, contentStore, experimentStore, experimentPipeline, workspaceRoot }) {
  const staticRoot = resolve(staticDir);
  const staticRootReal = existsSync(staticRoot) ? realpathSync(staticRoot) : staticRoot;
  const handleContentRoute = createContentRouteHandler({ contentStore, workspaceRoot: workspaceRoot ?? resolve(join(staticDir, "..", "..", "..")) });
  const handleExperimentRoute = createExperimentRouteHandler({ experimentStore, pipeline: experimentPipeline });

  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (await handleContentRoute(req, res, url)) {
      return true;
    }

    if (await handleExperimentRoute(req, res, url)) {
      return true;
    }

    if (url.pathname === "/studio/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, uptime: process.uptime() });
      return true;
    }

    if (url.pathname === "/studio/stats" && req.method === "GET") {
      sendJson(res, 200, statsStore.getStats());
      return true;
    }

    if (url.pathname === "/studio/team-tree" && req.method === "GET") {
      if (agentStateManager) {
        sendJson(res, 200, agentStateManager.getTreeState("kuma"));
      } else {
        sendJson(res, 200, { id: "kuma", state: "idle", nodeType: "session", children: [] });
      }
      return true;
    }

    if (url.pathname === "/studio/team-status" && req.method === "GET") {
      const projectId = url.searchParams.get("project");
      const snapshot = filterTeamStatusSnapshot(teamStatusStore?.getSnapshot() ?? { projects: {} }, projectId);
      sendJson(res, 200, toStudioTeamStatusSnapshot(snapshot));
      return true;
    }

    if (url.pathname === "/studio/daily-report" && req.method === "GET") {
      sendJson(res, 200, statsStore.getDailyReport());
      return true;
    }

    if (url.pathname === "/studio/skills" && req.method === "GET") {
      sendJson(res, 200, { skills: await readStudioSkills() });
      return true;
    }

    if (url.pathname === "/studio/plugins" && req.method === "GET") {
      sendJson(res, 200, { plugins: await readStudioPlugins() });
      return true;
    }

    if (url.pathname === "/studio/plans" && req.method === "GET") {
      try {
        sendJson(res, 200, await readPlans());
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read plans.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/claude-plans" && req.method === "GET") {
      try {
        sendJson(res, 200, { plans: await listClaudePlans() });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read Claude plans.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio/claude-plans/") && req.method === "DELETE") {
      const filename = decodeURIComponent(url.pathname.split("/studio/claude-plans/")[1]);
      const result = await deleteClaudePlan(filename);
      if (result.success) {
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, result.status || 500, { error: result.error });
      }
      return true;
    }

    if (url.pathname === "/studio/git-log" && req.method === "GET") {
      try {
        const raw = execSync("git log --oneline -10 --no-color", { cwd: resolve(join(staticDir, "..", "..", "..")), encoding: "utf-8", timeout: 3000 });
        const commits = raw.trim().split("\n").map((line) => {
          const [hash, ...rest] = line.split(" ");
          return { hash, message: rest.join(" ") };
        });
        sendJson(res, 200, { commits });
      } catch {
        sendJson(res, 200, { commits: [] });
      }
      return true;
    }

    if (url.pathname === "/studio/office-layout" && req.method === "GET") {
      try {
        sendJson(res, 200, sceneStore.readOfficeLayout());
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read office layout.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/office-layout" && req.method === "PUT") {
      try {
        sendJson(res, 200, sceneStore.writeOfficeLayout(await readJsonBody(req)));
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid office layout payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/agent-state" && req.method === "POST") {
      if (!agentStateManager) {
        sendJson(res, 503, { error: "Agent state manager is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid agent state payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
      const status = typeof body?.status === "string" ? body.status.trim() : "";
      const task =
        typeof body?.task === "string"
          ? body.task
          : body?.task == null
            ? null
            : String(body.task);

      if (!agentId) {
        sendJson(res, 400, { error: "Missing agentId." });
        return true;
      }

      if (!status) {
        sendJson(res, 400, { error: "Missing status." });
        return true;
      }

      if (!agentStateManager.setState(agentId, status, task)) {
        sendJson(res, 400, { error: `Invalid agent status: ${status}` });
        return true;
      }

      sendJson(res, 200, {
        agentId,
        status: agentStateManager.getState(agentId),
        task: agentStateManager.getTask(agentId),
      });
      return true;
    }

    // ------------------------------------------------------------------
    // File-system endpoints for IDE explorer
    // ------------------------------------------------------------------

    if (url.pathname === "/studio/fs/tree" && req.method === "GET") {
      const root = url.searchParams.get("root") || fsWorkspaceRoot;
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
        const s = await stat(resolved);
        if (!s.isFile()) {
          sendJson(res, 400, { error: "Not a file." });
          return true;
        }

        const ext = extname(resolved).toLowerCase();
        const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
        const imageMimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp" };

        if (imageExts.has(ext)) {
          const buf = await readFile(resolved);
          sendJson(res, 200, { content: buf.toString("base64"), mimeType: imageMimeMap[ext] || "application/octet-stream" });
          return true;
        }

        // Check if binary by reading first 8KB
        const buf = await readFile(resolved);
        const sample = buf.subarray(0, 8192);
        if (sample.includes(0)) {
          sendJson(res, 200, { binary: true, size: s.size });
          return true;
        }

        const langMap = {
          ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
          ".mjs": "javascript", ".cjs": "javascript", ".json": "json", ".md": "markdown",
          ".html": "html", ".css": "css", ".scss": "scss", ".py": "python", ".sh": "bash",
          ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".xml": "xml", ".sql": "sql",
          ".rs": "rust", ".go": "go", ".java": "java", ".rb": "ruby", ".php": "php",
          ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".swift": "swift",
        };

        sendJson(res, 200, { content: buf.toString("utf8"), language: langMap[ext] || "plaintext" });
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
        const s = await stat(resolved);
        if (!s.isFile()) {
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
        sendJson(res, 500, { error: "Failed to write file.", details: error instanceof Error ? error.message : "Unknown error" });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio/skills/") && req.method === "DELETE") {
      const skillName = decodeURIComponent(url.pathname.split("/studio/skills/")[1]);
      if (!skillName) { sendJson(res, 400, { error: "Missing skill name." }); return true; }
      const skillDir = join(homedir(), ".claude", "skills", skillName);
      try {
        const s = await stat(skillDir);
        if (!s.isDirectory()) { sendJson(res, 400, { error: "Not a skill directory." }); return true; }
        await rm(skillDir, { recursive: true, force: true });
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 500, { error: "Failed to delete skill.", details: error instanceof Error ? error.message : "Unknown error" });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio")) {
      let filePath = url.pathname.replace(/^\/studio\/?/, "");
      if (!filePath || filePath === "") filePath = "index.html";

      const fullPath = resolve(join(staticRoot, filePath));
      const relativePath = relative(staticRoot, fullPath);

      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
      }

      try {
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          if (!isPathWithinRoot(staticRoot, staticRootReal, fullPath)) {
            res.writeHead(403);
            res.end("Forbidden");
            return true;
          }

          const ext = extname(fullPath);
          const mime = MIME_TYPES[ext] ?? "application/octet-stream";
          const content = readFileSync(fullPath);
          res.writeHead(200, { "Content-Type": mime });
          res.end(content);
          return true;
        }

        const indexPath = resolve(join(staticRoot, "index.html"));
        if (existsSync(indexPath) && statSync(indexPath).isFile()) {
          if (!isPathWithinRoot(staticRoot, staticRootReal, indexPath)) {
            res.writeHead(403);
            res.end("Forbidden");
            return true;
          }

          const content = readFileSync(indexPath);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
          return true;
        }
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read studio asset.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      res.writeHead(404);
      res.end("Not Found");
      return true;
    }

    return false;
  };
}
