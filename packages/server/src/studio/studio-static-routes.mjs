import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { sendJson } from "../server-support.mjs";
import { getStudioMimeType, isPathWithinRoot } from "./studio-asset-utils.mjs";

export function createStudioStaticRouteHandler({ staticDir, studioDevDelegate = null } = {}) {
  const staticRoot = resolve(staticDir);
  const staticRootReal = existsSync(staticRoot) ? realpathSync(staticRoot) : staticRoot;

  return async (req, res, url) => {
    if (!url.pathname.startsWith("/studio")) {
      return false;
    }

    if (typeof studioDevDelegate === "function") {
      const handled = await studioDevDelegate(req, res, url);
      if (handled) {
        return true;
      }

      res.writeHead(404);
      res.end("Not Found");
      return true;
    }

    let filePath = url.pathname.replace(/^\/studio\/?/, "");
    if (!filePath) {
      filePath = "index.html";
    }

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

        const content = readFileSync(fullPath);
        res.writeHead(200, { "Content-Type": getStudioMimeType(fullPath) });
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
  };
}
