/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";

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
 * Attach studio routes to an existing HTTP server request handler.
 *
 * @param {object} options
 * @param {string} options.staticDir - absolute path to the studio-web dist directory
 * @param {import("./stats-store.mjs").StatsStore} options.statsStore
 * @returns {(req: import("http").IncomingMessage, res: import("http").ServerResponse) => boolean}
 *   Returns true if the request was handled, false otherwise.
 */
export function createStudioRouteHandler({ staticDir, statsStore }) {
  return (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // REST API: stats endpoint
    if (url.pathname === "/studio/stats" && req.method === "GET") {
      const stats = statsStore.getStats();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats));
      return true;
    }

    // Static file serving for /studio/*
    if (url.pathname.startsWith("/studio")) {
      let filePath = url.pathname.replace(/^\/studio\/?/, "");
      if (!filePath || filePath === "") filePath = "index.html";

      const fullPath = resolve(join(staticDir, filePath));

      // Security: ensure we're not escaping the static dir
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

      // SPA fallback: serve index.html for client-side routing
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
