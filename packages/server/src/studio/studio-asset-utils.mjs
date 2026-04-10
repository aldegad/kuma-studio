import { realpathSync } from "node:fs";
import { extname, isAbsolute, relative } from "node:path";

export const STUDIO_MIME_TYPES = {
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

export function getStudioMimeType(filePath) {
  return STUDIO_MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function isPathWithinRoot(rootPath, rootRealPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }

  const realCandidatePath = realpathSync(candidatePath);
  const realRelativePath = relative(rootRealPath, realCandidatePath);
  return !(realRelativePath.startsWith("..") || isAbsolute(realRelativePath));
}
