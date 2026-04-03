/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats and office layout state.
 */

import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve, join, extname, relative, isAbsolute } from "node:path";
import { readJsonBody, sendJson } from "../server-support.mjs";
import { readPlans } from "./plan-store.mjs";

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
        const [firstLine = ""] = content.split(/\r?\n/u);

        skills.push({
          name: entry.name,
          description: firstLine.replace(/^#\s*/u, "").trim(),
          file: skillFile,
          content,
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

/**
 * @param {object} options
 * @param {string} options.staticDir
 * @param {import("./stats-store.mjs").StatsStore} options.statsStore
 * @param {import("../scene-store.mjs").SceneStore} options.sceneStore
 * @returns {(req: import("http").IncomingMessage, res: import("http").ServerResponse) => Promise<boolean>}
 */
export function createStudioRouteHandler({ staticDir, statsStore, sceneStore, agentStateManager }) {
  const staticRoot = resolve(staticDir);
  const staticRootReal = existsSync(staticRoot) ? realpathSync(staticRoot) : staticRoot;

  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

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

    if (url.pathname === "/studio/git-log" && req.method === "GET") {
      try {
        const raw = execSync("git log --oneline -10 --no-color", { cwd: resolve(join(staticDir, "..", "..")), encoding: "utf-8", timeout: 3000 });
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
