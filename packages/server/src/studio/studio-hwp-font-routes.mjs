import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import { sendBinary, sendJson } from "../server-support.mjs";

export const DEFAULT_HWP_FONT_DIR = resolve(join(homedir(), ".kuma", "studio", "fonts", "hwp"));

const FONT_MIME_BY_EXTENSION = new Map([
  [".otf", "font/otf"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function isSafeFontFileName(fileName) {
  return /^[A-Za-z0-9가-힣._ -]+$/u.test(fileName) && FONT_MIME_BY_EXTENSION.has(extname(fileName).toLowerCase());
}

async function listFontFiles(fontDir) {
  if (!existsSync(fontDir)) {
    return [];
  }

  const entries = await readdir(fontDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isSafeFontFileName(entry.name)) {
      continue;
    }

    const filePath = join(fontDir, entry.name);
    const metadata = await stat(filePath).catch(() => null);
    files.push({
      name: entry.name,
      size: metadata?.size ?? 0,
      url: `/studio/hwp-fonts/${encodeURIComponent(entry.name)}`,
    });
  }

  files.sort((left, right) => left.name.localeCompare(right.name));
  return files;
}

/**
 * Runtime HWP font assets live outside the repo so font files do not become a
 * second source of truth in git. Install/copy fonts into ~/.kuma/studio/fonts/hwp.
 */
export function createStudioHwpFontRouteHandler({ fontDir = DEFAULT_HWP_FONT_DIR } = {}) {
  const resolvedFontDir = resolve(fontDir);

  return async (req, res, url) => {
    if (url.pathname === "/studio/hwp-fonts" && req.method === "GET") {
      sendJson(res, 200, {
        fontDir: resolvedFontDir,
        files: await listFontFiles(resolvedFontDir),
      });
      return true;
    }

    const match = url.pathname.match(/^\/studio\/hwp-fonts\/([^/]+)$/u);
    if (!match || req.method !== "GET") {
      return false;
    }

    const fileName = decodeURIComponent(match[1]);
    if (basename(fileName) !== fileName || !isSafeFontFileName(fileName)) {
      sendJson(res, 400, { error: "Invalid HWP font file name." });
      return true;
    }

    const filePath = resolve(join(resolvedFontDir, fileName));
    if (!filePath.startsWith(`${resolvedFontDir}/`) && filePath !== resolvedFontDir) {
      sendJson(res, 400, { error: "Invalid HWP font path." });
      return true;
    }

    if (!existsSync(filePath)) {
      sendJson(res, 404, { error: "HWP font file is not installed." });
      return true;
    }

    const extension = extname(fileName).toLowerCase();
    const mimeType = FONT_MIME_BY_EXTENSION.get(extension);
    sendBinary(res, 200, await readFile(filePath), mimeType);
    return true;
  };
}
