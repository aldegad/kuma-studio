/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats and office layout state.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join, extname } from "node:path";
import { readJsonBody, sendJson } from "../server-support.mjs";

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
export function createStudioRouteHandler({ staticDir, statsStore, sceneStore }) {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/studio/stats" && req.method === "GET") {
      sendJson(res, 200, statsStore.getStats());
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

    if (url.pathname === "/studio/office-layout" && req.method === "GET") {
      sendJson(res, 200, sceneStore.readOfficeLayout());
      return true;
    }

    if (url.pathname === "/studio/office-layout" && req.method === "PUT") {
      sendJson(res, 200, sceneStore.writeOfficeLayout(await readJsonBody(req)));
      return true;
    }

    if (url.pathname.startsWith("/studio")) {
      let filePath = url.pathname.replace(/^\/studio\/?/, "");
      if (!filePath || filePath === "") filePath = "index.html";

      const fullPath = resolve(join(staticDir, filePath));

      if (!fullPath.startsWith(staticDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
      }

      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const ext = extname(fullPath);
        const mime = MIME_TYPES[ext] ?? "application/octet-stream";
        const content = readFileSync(fullPath);
        res.writeHead(200, { "Content-Type": mime });
        res.end(content);
        return true;
      }

      const indexPath = resolve(join(staticDir, "index.html"));
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
        return true;
      }

      res.writeHead(404);
      res.end("Not Found");
      return true;
    }

    return false;
  };
}
