import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { readJsonBody, sendJson } from "../server-support.mjs";
import { resolveVaultImagesDir } from "./memo-store.mjs";
import { getStudioMimeType } from "./studio-asset-utils.mjs";
import { syncVaultSkills } from "./vault-skill-sync.mjs";

export function createStudioMemoRouteHandler({ memoStore, vaultSkillSyncFn } = {}) {
  return async (req, res, url) => {
    if (url.pathname === "/studio/memos" && req.method === "GET") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      try {
        sendJson(res, 200, {
          memos: await memoStore.list(),
        });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read memos.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/vault" && req.method === "GET") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      try {
        sendJson(res, 200, {
          memos: await memoStore.list(),
          inbox: await memoStore.listInbox(),
        });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read vault entries.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/vault/sync-skills" && req.method === "POST") {
      try {
        const syncResult = await (vaultSkillSyncFn ?? syncVaultSkills)({
          vaultDir: memoStore?.getVaultDir?.(),
        });
        sendJson(res, 200, syncResult);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to sync skill documents into the vault.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/vault/inbox" && req.method === "POST") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid memo payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text) {
        sendJson(res, 400, { error: "Missing inbox text." });
        return true;
      }

      try {
        const memo = await memoStore.addInbox({
          title: typeof body?.title === "string" ? body.title : "Inbox",
          text,
        });
        sendJson(res, 201, memo);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to create inbox entry.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if ((url.pathname === "/studio/vault" || url.pathname === "/studio/memos") && req.method === "POST") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid memo payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const title = typeof body?.title === "string" ? body.title.trim() : "";
      if (!title) {
        sendJson(res, 400, { error: "Missing title." });
        return true;
      }

      try {
        const memo = await memoStore.add({
          title,
          text: typeof body?.text === "string" ? body.text : "",
          images: Array.isArray(body?.images) ? body.images : [],
        });
        sendJson(res, 201, memo);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to create memo.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if ((url.pathname.startsWith("/studio/vault/") || url.pathname.startsWith("/studio/memos/")) && req.method === "DELETE") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      const memoId = url.pathname.startsWith("/studio/vault/")
        ? decodeURIComponent(url.pathname.slice("/studio/vault/".length))
        : decodeURIComponent(url.pathname.slice("/studio/memos/".length));
      const result = await memoStore.delete(memoId);
      if (result.success) {
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, result.status || 500, { error: result.error });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio/memo-images/")) {
      const imageName = basename(decodeURIComponent(url.pathname.split("/studio/memo-images/")[1] ?? ""));
      const resolvedPath = memoStore?.findImagePath?.(imageName);
      const imageDir = memoStore?.getImagesDir?.() ?? resolveVaultImagesDir();
      const fullPath = resolvedPath ?? resolve(join(imageDir, imageName));

      try {
        if (imageName && existsSync(fullPath) && statSync(fullPath).isFile()) {
          const content = readFileSync(fullPath);
          res.writeHead(200, { "Content-Type": getStudioMimeType(fullPath) });
          res.end(content);
          return true;
        }
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read memo image.",
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
