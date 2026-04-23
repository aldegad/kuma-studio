import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

import { sendJson } from "../server-support.mjs";
import { getStudioMimeType, isPathWithinRoot } from "./studio-asset-utils.mjs";

export const DEFAULT_HWP_EDITOR_DIR = resolve(join(homedir(), ".kuma", "studio", "rhwp-editor"));

function getEditorMimeType(filePath) {
  if (extname(filePath).toLowerCase() === ".wasm") {
    return "application/wasm";
  }
  return getStudioMimeType(filePath);
}

export function createStudioHwpEditorRouteHandler({ editorDir = process.env.KUMA_RHWP_EDITOR_DIR || DEFAULT_HWP_EDITOR_DIR } = {}) {
  const editorRoot = resolve(editorDir);
  const editorRootReal = existsSync(editorRoot) ? realpathSync(editorRoot) : editorRoot;

  return async (_req, res, url) => {
    if (url.pathname === "/studio/hwp-editor-status") {
      const installed = existsSync(resolve(join(editorRoot, "index.html")));
      sendJson(res, 200, {
        installed,
        editorDir: editorRoot,
        url: "/studio/hwp-editor/",
      });
      return true;
    }

    if (url.pathname !== "/studio/hwp-editor" && !url.pathname.startsWith("/studio/hwp-editor/")) {
      return false;
    }

    if (!existsSync(editorRoot) || !existsSync(resolve(join(editorRoot, "index.html")))) {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><body><h1>HWP editor assets are not installed.</h1><p>${editorRoot}</p></body>`);
      return true;
    }

    let filePath;
    try {
      filePath = decodeURIComponent(url.pathname.replace(/^\/studio\/hwp-editor\/?/, ""));
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return true;
    }
    if (!filePath) {
      filePath = "index.html";
    }

    const fullPath = resolve(join(editorRoot, filePath));
    const relativePath = relative(editorRoot, fullPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      res.writeHead(403);
      res.end("Forbidden");
      return true;
    }

    try {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        if (!isPathWithinRoot(editorRoot, editorRootReal, fullPath)) {
          res.writeHead(403);
          res.end("Forbidden");
          return true;
        }
        const content = readFileSync(fullPath);
        res.writeHead(200, { "Content-Type": getEditorMimeType(fullPath) });
        res.end(content);
        return true;
      }

      const indexPath = resolve(join(editorRoot, "index.html"));
      if (!isPathWithinRoot(editorRoot, editorRootReal, indexPath)) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
      }
      const content = readFileSync(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
      return true;
    } catch (error) {
      sendJson(res, 500, {
        error: "Failed to read HWP editor asset.",
        details: error instanceof Error ? error.message : "Unknown error",
      });
      return true;
    }
  };
}
