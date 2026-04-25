import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";

import { readJsonBody, sendJson } from "../server-support.mjs";
import { resolveVaultDir, resolveVaultImagesDir } from "./memo-store.mjs";
import { getStudioMimeType } from "./studio-asset-utils.mjs";
import { parseFrontmatterDocument, stringifyFrontmatter } from "./vault-ingest.mjs";

const THREAD_STATUSES = new Set(["draft", "approved", "posted"]);

function resolveThreadsContentRoot(rootOverride) {
  return resolve(rootOverride ?? join(resolveVaultDir(), "domains", "threads-content"));
}

function isWithinRoot(root, candidatePath) {
  const relativePath = relative(root, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function normalizeThreadStatus(value) {
  return THREAD_STATUSES.has(value) ? value : "draft";
}

function createThreadDocumentId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `thread-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

function resolveThreadDocumentPath(root, id) {
  const safeId = String(id ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!safeId) {
    throw new Error("Invalid thread document id.");
  }
  return resolve(join(root, `${safeId}.md`));
}

function serializeThreadDocument({ title, status, created, updated, body }) {
  const frontmatter = {
    title: String(title || "새 스레드").trim() || "새 스레드",
    status: normalizeThreadStatus(status),
    created,
    updated,
  };
  const normalizedBody = typeof body === "string" ? body.replace(/\r\n/gu, "\n").trim() : "";
  return `${stringifyFrontmatter(frontmatter)}\n\n${normalizedBody}\n`;
}

async function readThreadDocument(root, fileName) {
  const filePath = resolve(join(root, fileName));
  const raw = await readFile(filePath, "utf8");
  const parsed = parseFrontmatterDocument(raw);
  const metadata = statSync(filePath);
  const id = basename(fileName, extname(fileName));
  const created =
    typeof parsed.frontmatter.created === "string" && parsed.frontmatter.created.trim()
      ? parsed.frontmatter.created.trim()
      : metadata.birthtime.toISOString();
  const updated =
    typeof parsed.frontmatter.updated === "string" && parsed.frontmatter.updated.trim()
      ? parsed.frontmatter.updated.trim()
      : metadata.mtime.toISOString();

  return {
    id,
    fileName,
    path: filePath,
    title:
      typeof parsed.frontmatter.title === "string" && parsed.frontmatter.title.trim()
        ? parsed.frontmatter.title.trim()
        : id,
    status: normalizeThreadStatus(parsed.frontmatter.status),
    created,
    updated,
    body: parsed.body,
  };
}

async function listThreadDocuments(root) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".md")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const items = await Promise.all(files.map((fileName) => readThreadDocument(root, fileName)));
  items.sort((left, right) => right.updated.localeCompare(left.updated));
  return items;
}

export function createStudioMemoRouteHandler({ memoStore, threadsContentRoot, studioWsEvents } = {}) {
  const resolvedThreadsContentRoot = resolveThreadsContentRoot(threadsContentRoot);
  const vaultRoot = resolve(memoStore?.getVaultDir?.() ?? resolveVaultDir());

  function broadcastFilesystemRouteChange(filePath, eventType, origin) {
    if (!studioWsEvents?.broadcastFilesystemChange) {
      return;
    }

    const resolvedPath = resolve(filePath);
    const isVaultBacked = isWithinRoot(vaultRoot, resolvedPath);
    const rootPath = isVaultBacked ? vaultRoot : resolvedThreadsContentRoot;

    studioWsEvents.broadcastFilesystemChange({
      changes: [{
        rootId: isVaultBacked ? "vault" : "threads-content",
        rootPath,
        eventType,
        path: resolvedPath,
        relativePath: relative(rootPath, resolvedPath) || ".",
        origin,
        changedAt: new Date().toISOString(),
      }],
    });
  }

  function broadcastThreadDocumentChange(filePath, eventType) {
    broadcastFilesystemRouteChange(filePath, eventType, "thread-document-route");
  }

  function broadcastMemoChange(filePath, eventType) {
    broadcastFilesystemRouteChange(filePath, eventType, "memo-route");
  }

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

    if (url.pathname === "/studio/vault/threads-content" && req.method === "GET") {
      try {
        sendJson(res, 200, {
          directory: resolvedThreadsContentRoot,
          items: await listThreadDocuments(resolvedThreadsContentRoot),
        });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read thread documents.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/vault/threads-content" && req.method === "POST") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid thread document payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      try {
        await mkdir(resolvedThreadsContentRoot, { recursive: true });
        const id = createThreadDocumentId();
        const now = new Date().toISOString();
        const filePath = resolveThreadDocumentPath(resolvedThreadsContentRoot, id);
        const content = serializeThreadDocument({
          title: typeof body?.title === "string" ? body.title : "새 스레드",
          status: body?.status,
          created: now,
          updated: now,
          body: typeof body?.body === "string" ? body.body : "",
        });
        await writeFile(filePath, content, "utf8");
        broadcastThreadDocumentChange(filePath, "change");
        sendJson(res, 201, await readThreadDocument(resolvedThreadsContentRoot, basename(filePath)));
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to create thread document.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    const threadDocumentMatch = url.pathname.match(/^\/studio\/vault\/threads-content\/([^/]+)$/u);
    if (threadDocumentMatch && req.method === "PATCH") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid thread document payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      try {
        await mkdir(resolvedThreadsContentRoot, { recursive: true });
        const id = decodeURIComponent(threadDocumentMatch[1]);
        const filePath = resolveThreadDocumentPath(resolvedThreadsContentRoot, id);
        if (!existsSync(filePath)) {
          sendJson(res, 404, { error: "Thread document not found." });
          return true;
        }

        const current = await readThreadDocument(resolvedThreadsContentRoot, basename(filePath));
        const nextUpdated = new Date().toISOString();
        const content = serializeThreadDocument({
          title: typeof body?.title === "string" ? body.title : current.title,
          status: Object.prototype.hasOwnProperty.call(body ?? {}, "status") ? body?.status : current.status,
          created: current.created,
          updated: nextUpdated,
          body: typeof body?.body === "string" ? body.body : current.body,
        });
        await writeFile(filePath, content, "utf8");
        broadcastThreadDocumentChange(filePath, "change");
        sendJson(res, 200, await readThreadDocument(resolvedThreadsContentRoot, basename(filePath)));
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to update thread document.",
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
        const inboxPath = memoStore.resolveEntryPath?.(`inbox/${memo.id}`) ?? resolve(join(memoStore.getInboxDir?.() ?? join(vaultRoot, "inbox"), memo.id));
        broadcastMemoChange(inboxPath, "change");
        sendJson(res, 201, memo);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to create inbox entry.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/memos" && req.method === "POST") {
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
        const memoPath = memoStore.resolveEntryPath?.(memo.id) ?? resolve(join(memoStore.getMemosDir?.() ?? join(vaultRoot, "memos"), memo.id));
        broadcastMemoChange(memoPath, "change");
        sendJson(res, 201, memo);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to create memo.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio/memos/") && req.method === "DELETE") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      const memoId = decodeURIComponent(url.pathname.slice("/studio/memos/".length));
      const memoPath = memoStore.resolveEntryPath?.(memoId) ?? resolve(join(memoStore.getMemosDir?.() ?? join(vaultRoot, "memos"), memoId));
      const result = await memoStore.delete(memoId);
      if (result.success) {
        broadcastMemoChange(memoPath, "delete");
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
