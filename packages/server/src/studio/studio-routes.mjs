/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats and office layout state.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
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
