import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { readJsonBody, sendJson } from "../server-support.mjs";
import { isWithinRoot, resolveExplorerRootsConfig } from "./studio-explorer-routes.mjs";

const DEFAULT_LINKS_PATH = resolve(join(homedir(), ".kuma", "studio", "hwp-external-links.json"));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLinks(value) {
  if (!isRecord(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .filter(([filePath, url]) => typeof filePath === "string" && filePath.length > 0 && typeof url === "string" && url.length > 0);
  return Object.fromEntries(entries);
}

function isAllowedPath(allowedRoots, candidatePath) {
  const resolved = resolve(candidatePath);
  return allowedRoots.some((root) => isWithinRoot(root, resolved));
}

function normalizeWebHwpUrl(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("WebHWP URL must be a string.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid WebHWP URL.");
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "webhwp.hancomdocs.com" || parsed.pathname !== "/webhwp/") {
    throw new Error("Only https://webhwp.hancomdocs.com/webhwp/ URLs are supported.");
  }

  if (!parsed.searchParams.get("docId")) {
    throw new Error("WebHWP URL must include docId.");
  }

  return parsed.toString();
}

export class StudioHwpExternalLinkStore {
  constructor({ storagePath = DEFAULT_LINKS_PATH } = {}) {
    this.storagePath = storagePath;
  }

  async readAll() {
    if (!existsSync(this.storagePath)) {
      return {};
    }

    try {
      return normalizeLinks(JSON.parse(await readFile(this.storagePath, "utf8")));
    } catch {
      return {};
    }
  }

  async get(filePath) {
    const links = await this.readAll();
    return links[resolve(filePath)] ?? null;
  }

  async set(filePath, url) {
    const resolvedPath = resolve(filePath);
    const normalizedUrl = normalizeWebHwpUrl(url);
    const links = await this.readAll();
    if (normalizedUrl) {
      links[resolvedPath] = normalizedUrl;
    } else {
      delete links[resolvedPath];
    }
    await this.#writeAtomic(links);
    return links[resolvedPath] ?? null;
  }

  async #writeAtomic(links) {
    await mkdir(dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(normalizeLinks(links), null, 2)}\n`, "utf8");
    await rename(tempPath, this.storagePath);
  }
}

export function createStudioHwpExternalLinkRouteHandler({
  workspaceRoot,
  globalRoots,
  systemRoot,
  readProjectRoots,
  store = new StudioHwpExternalLinkStore(),
} = {}) {
  return async (req, res, url) => {
    if (url.pathname !== "/studio/hwp-external-link") {
      return false;
    }

    const { allowedRoots } = resolveExplorerRootsConfig({
      workspaceRoot,
      globalRoots,
      systemRoot,
      readProjectRoots,
    });

    if (req.method === "GET") {
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        sendJson(res, 400, { error: "Missing path parameter." });
        return true;
      }

      const resolvedPath = resolve(filePath);
      if (!isAllowedPath(allowedRoots, resolvedPath)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      sendJson(res, 200, { path: resolvedPath, url: await store.get(resolvedPath) });
      return true;
    }

    if (req.method === "PUT") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid WebHWP link payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const filePath = body?.path;
      if (typeof filePath !== "string" || !filePath.trim()) {
        sendJson(res, 400, { error: "Missing path parameter." });
        return true;
      }

      const resolvedPath = resolve(filePath);
      if (!isAllowedPath(allowedRoots, resolvedPath)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        sendJson(res, 200, { path: resolvedPath, url: await store.set(resolvedPath, body?.url ?? null) });
      } catch (error) {
        sendJson(res, 400, {
          error: "Failed to save WebHWP link.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    sendJson(res, 405, { error: "Method not allowed." });
    return true;
  };
}
