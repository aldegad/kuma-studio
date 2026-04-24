import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, normalize, relative, resolve } from "node:path";
import { homedir } from "node:os";

import { parseFrontmatterDocument, stringifyFrontmatter } from "./vault-ingest.mjs";

const MEMO_IMAGE_ROUTE_PREFIX = "/studio/memo-images/";
const LEGACY_MEMORY_INDEX_FILE_NAME = "MEMORY.md";
const INBOX_ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json", ".log"]);
const LEGACY_SEED_MEMO_IDS = new Set([
  "bench-sdxl-vs-hyper",
  "bench-euler-grid",
  "bench-euler_a-grid",
  "token-efficiency-report-2026-04-06",
]);

const VAULT_SCAFFOLD_FILES = {
  "index.md": `# Kuma Vault Index

## Domains
(아직 없음)

## Projects
(아직 없음)

## Memos
(아직 없음)

## Learnings
(아직 없음)

## Results
(아직 없음)

## Inbox
(비어 있음)

## Cross References
(아직 없음)
`,
  "schema.md": `---
title: Kuma Vault Schema
description: Vault 페이지 작성 규칙과 운영 원칙
---

# Kuma Vault Schema

## Canonical Slots
- domains/
- projects/
- memos/
- learnings/
- results/
- inbox/

## Special Files

### 1) \`dispatch-log.md\`

- **Primary writer:** \`kuma-dispatch lifecycle hook\`
- **Frontmatter type 표준:** \`type: special/dispatch-log\`

### 2) \`decisions.md\`

- **Primary writer:** \`user-direct\`
- **Frontmatter type 표준:** \`type: special/decisions\`
`,
  "log.md": `# Kuma Vault Change Log

## 2026-04-07
- INIT: vault scaffold initialized
`,
};

const VAULT_SCAFFOLD_DIRS = ["domains", "projects", "memos", "learnings", "results", "inbox"];

function toMemoImageFilename(image) {
  if (typeof image !== "string") {
    return null;
  }

  const withoutQuery = image.split("?")[0];
  const filename = basename(withoutQuery);
  return filename || null;
}

function memoImageUrl(filename) {
  return `${MEMO_IMAGE_ROUTE_PREFIX}${filename}`;
}

function sortMemosDesc(memos) {
  return [...memos].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function toMemoMarkdown(memo) {
  const body = memo.text?.trim() ?? "";
  return `${stringifyFrontmatter({
    title: memo.title,
    created: memo.createdAt,
    updated: memo.updatedAt ?? memo.createdAt,
    images: memo.images,
  })}\n\n${body}\n`;
}

function normalizeRelativePath(pathValue) {
  return String(pathValue ?? "").replace(/\\/gu, "/").replace(/^\/+/u, "");
}

function sanitizeEntryId(entryId) {
  const normalizedId = normalizeRelativePath(entryId).trim();
  if (!normalizedId || normalizedId.includes("..")) {
    return null;
  }
  return normalizedId;
}

function titleFromPath(filePath) {
  const fileName = basename(filePath, extname(filePath));
  return fileName.replace(/[-_]+/gu, " ").trim() || fileName;
}

/**
 * Resolve the vault directory.
 * Priority: KUMA_VAULT_DIR > ~/.kuma/vault
 */
export function resolveVaultDir() {
  if (process.env.KUMA_VAULT_DIR) {
    return resolve(process.env.KUMA_VAULT_DIR);
  }

  return resolve(homedir(), ".kuma", "vault");
}

export function resolveVaultMemosDir() {
  return join(resolveVaultDir(), "memos");
}

export function resolveVaultImagesDir() {
  return join(resolveVaultDir(), "images");
}

function resolveLegacyRawMemosDir() {
  return join(resolveVaultDir(), "raw", "memos");
}

function resolveLegacyMemoDir() {
  return resolve(homedir(), ".kuma", "memos");
}

async function moveFile(sourcePath, targetPath) {
  try {
    await rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
    await copyFile(sourcePath, targetPath);
    await unlink(sourcePath);
  }
}

async function filesHaveSameBytes(leftPath, rightPath) {
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  return left.equals(right);
}

async function walkFiles(dir, {
  recursive = true,
  allowedExtensions = null,
  skipDirNames = new Set(),
} = {}) {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!recursive || skipDirNames.has(entry.name)) {
        continue;
      }
      files.push(...await walkFiles(fullPath, { recursive, allowedExtensions, skipDirNames }));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (allowedExtensions && !allowedExtensions.has(extension)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

export class MemoStore {
  #ensurePromise = null;

  constructor(_root) {}

  getVaultDir() {
    return resolveVaultDir();
  }

  getInboxDir() {
    return join(this.getVaultDir(), "inbox");
  }

  getMemosDir() {
    return resolveVaultMemosDir();
  }

  getImagesDir() {
    return resolveVaultImagesDir();
  }

  async #ensureReady() {
    if (!this.#ensurePromise) {
      this.#ensurePromise = this.#ensureSeedData().catch((error) => {
        this.#ensurePromise = null;
        throw error;
      });
    }
    return this.#ensurePromise;
  }

  async #migrateLegacyMemos() {
    const legacyMemoDir = resolveLegacyMemoDir();
    if (!existsSync(legacyMemoDir)) {
      return;
    }

    const legacyFiles = await walkFiles(legacyMemoDir, {
      recursive: false,
      allowedExtensions: new Set([".md"]),
    });

    for (const legacyFile of legacyFiles) {
      const relativePath = normalizeRelativePath(relative(legacyMemoDir, legacyFile));
      const fileName = basename(relativePath);
      const memoId = basename(fileName, extname(fileName));

      if (fileName === LEGACY_MEMORY_INDEX_FILE_NAME || LEGACY_SEED_MEMO_IDS.has(memoId)) {
        await unlink(legacyFile).catch((error) => {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        });
        continue;
      }

      const targetPath = join(this.getMemosDir(), fileName);
      if (existsSync(targetPath)) {
        await unlink(legacyFile).catch((error) => {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        });
        continue;
      }

      await moveFile(legacyFile, targetPath);
    }
  }

  async #migrateLegacyRawMemos() {
    const legacyRawMemoDir = resolveLegacyRawMemosDir();
    if (!existsSync(legacyRawMemoDir)) {
      return;
    }

    const memosDir = this.getMemosDir();
    const vaultImagesDir = this.getImagesDir();
    const legacyRawImagesDir = join(legacyRawMemoDir, "images");

    await mkdir(memosDir, { recursive: true });
    await mkdir(vaultImagesDir, { recursive: true });

    const legacyMemoFiles = await walkFiles(legacyRawMemoDir, {
      recursive: false,
      allowedExtensions: new Set([".md"]),
    });

    for (const legacyFile of legacyMemoFiles) {
      const fileName = basename(legacyFile);
      const targetPath = join(memosDir, fileName);

      if (existsSync(targetPath)) {
        await unlink(legacyFile).catch((error) => {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        });
        continue;
      }

      const rawContent = await readFile(legacyFile, "utf8");
      const { frontmatter, body } = parseFrontmatterDocument(rawContent);
      const legacyStat = await stat(legacyFile);
      const createdAt =
        typeof frontmatter.created === "string" && frontmatter.created.trim()
          ? frontmatter.created.trim()
          : legacyStat.mtime.toISOString();
      const updatedAt =
        typeof frontmatter.updated === "string" && frontmatter.updated.trim()
          ? frontmatter.updated.trim()
          : createdAt;
      const normalizedMemo = {
        title: typeof frontmatter.title === "string" ? frontmatter.title : titleFromPath(fileName),
        text: body,
        images: Array.isArray(frontmatter.images)
          ? frontmatter.images.map((image) => toMemoImageFilename(image)).filter(Boolean)
          : [],
        createdAt,
        updatedAt,
      };

      await writeFile(targetPath, toMemoMarkdown(normalizedMemo), "utf8");
      await unlink(legacyFile);
    }

    const legacyImageFiles = await walkFiles(legacyRawImagesDir, {
      recursive: false,
    });

    for (const legacyImagePath of legacyImageFiles) {
      const imageName = basename(legacyImagePath);
      const targetPath = join(vaultImagesDir, imageName);

      if (!existsSync(targetPath)) {
        await moveFile(legacyImagePath, targetPath);
        continue;
      }

      if (!(await filesHaveSameBytes(legacyImagePath, targetPath))) {
        throw new Error(
          `Legacy raw memo image conflicts with canonical vault image: ${imageName}`,
        );
      }

      await unlink(legacyImagePath);
    }

    if (existsSync(legacyRawImagesDir)) {
      const remainingImageEntries = await readdir(legacyRawImagesDir);
      if (remainingImageEntries.length === 0) {
        await rmdir(legacyRawImagesDir);
      }
    }

    if (existsSync(legacyRawMemoDir)) {
      const remainingEntries = await readdir(legacyRawMemoDir);
      if (remainingEntries.length === 0) {
        await rmdir(legacyRawMemoDir);
      }
    }
  }

  async #ensureSeedData() {
    const vaultDir = this.getVaultDir();
    const inboxDir = this.getInboxDir();
    const memosDir = this.getMemosDir();
    const vaultImagesDir = resolveVaultImagesDir();

    await mkdir(vaultDir, { recursive: true });
    await mkdir(inboxDir, { recursive: true });
    await mkdir(memosDir, { recursive: true });
    await mkdir(vaultImagesDir, { recursive: true });

    for (const dirName of VAULT_SCAFFOLD_DIRS) {
      await mkdir(join(vaultDir, dirName), { recursive: true });
    }

    for (const [filename, content] of Object.entries(VAULT_SCAFFOLD_FILES)) {
      const targetPath = join(vaultDir, filename);
      if (!existsSync(targetPath)) {
        await writeFile(targetPath, content, "utf8");
      }
    }

    await this.#migrateLegacyMemos();
    await this.#migrateLegacyRawMemos();
  }

  async #readEntryFile(fullPath, rootDir, { source, section, prefix = "" }) {
    const relativePath = normalizeRelativePath(relative(rootDir, fullPath));
    const stats = await stat(fullPath);
    const extension = extname(fullPath).toLowerCase();
    const entryId = `${prefix}${relativePath}`;
    const content = await readFile(fullPath, "utf8");

    if (extension === ".md") {
      const { frontmatter, body } = parseFrontmatterDocument(content);
      const rawImages = Array.isArray(frontmatter.images) ? frontmatter.images : [];
      return {
        id: entryId,
        path: entryId,
        title: typeof frontmatter.title === "string" ? frontmatter.title : titleFromPath(relativePath),
        text: body || undefined,
        images: rawImages
          .map((image) => toMemoImageFilename(image))
          .filter(Boolean)
          .map((filename) => memoImageUrl(filename)),
        createdAt:
          typeof frontmatter.created === "string"
            ? frontmatter.created
            : stats.mtime.toISOString(),
        source,
        section,
      };
    }

    return {
      id: entryId,
      path: entryId,
      title: titleFromPath(relativePath),
      text: content.trim() || undefined,
      images: [],
      createdAt: stats.mtime.toISOString(),
      source,
      section,
    };
  }

  async #readMemoEntries() {
    const memosDir = this.getMemosDir();
    const files = await walkFiles(memosDir, {
      recursive: false,
      allowedExtensions: new Set([".md"]),
    });

    const entries = [];
    for (const file of files) {
      const relativePath = normalizeRelativePath(relative(memosDir, file));
      const fileName = basename(relativePath);
      if (fileName === LEGACY_MEMORY_INDEX_FILE_NAME) {
        continue;
      }
      entries.push(await this.#readEntryFile(file, memosDir, { source: "vault", section: "memos" }));
    }
    return entries;
  }

  async #readInboxEntries() {
    const inboxDir = this.getInboxDir();
    const files = await walkFiles(inboxDir, {
      recursive: true,
      allowedExtensions: INBOX_ALLOWED_EXTENSIONS,
    });

    const entries = [];
    for (const file of files) {
      entries.push(await this.#readEntryFile(file, this.getVaultDir(), {
        source: "vault",
        section: "inbox",
      }));
    }
    return entries;
  }

  async list() {
    await this.#ensureReady();
    return sortMemosDesc(await this.#readMemoEntries());
  }

  async listInbox() {
    await this.#ensureReady();
    return sortMemosDesc(await this.#readInboxEntries());
  }

  async add(input) {
    await this.#ensureReady();

    const fileName = `${randomUUID()}.md`;
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    const memo = {
      title: String(input?.title ?? "").trim() || "Untitled Memo",
      text: typeof input?.text === "string" ? input.text.trim() : "",
      images: Array.isArray(input?.images)
        ? input.images.map((image) => toMemoImageFilename(image)).filter(Boolean)
        : [],
      createdAt,
      updatedAt,
    };

    await writeFile(join(this.getMemosDir(), fileName), toMemoMarkdown(memo), "utf8");

    return {
      id: fileName,
      path: fileName,
      title: memo.title,
      text: memo.text || undefined,
      images: memo.images.map((image) => memoImageUrl(image)),
      createdAt,
      source: "vault",
      section: "memos",
    };
  }

  async addInbox(input) {
    await this.#ensureReady();

    const fileName = `${randomUUID()}.md`;
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    const title = String(input?.title ?? "").trim() || "Inbox";
    const memo = {
      title,
      text: typeof input?.text === "string" ? input.text.trim() : "",
      images: [],
      createdAt,
      updatedAt,
    };

    await writeFile(join(this.getInboxDir(), fileName), toMemoMarkdown(memo), "utf8");

    return {
      id: `inbox/${fileName}`,
      path: `inbox/${fileName}`,
      title,
      text: memo.text || undefined,
      images: [],
      createdAt,
      source: "vault",
      section: "inbox",
    };
  }

  resolveEntryPath(entryId) {
    const sanitizedId = sanitizeEntryId(entryId);
    if (!sanitizedId) {
      return null;
    }

    if (sanitizedId.startsWith("inbox/")) {
      const vaultDir = this.getVaultDir();
      const targetPath = resolve(vaultDir, normalize(sanitizedId));
      return targetPath.startsWith(vaultDir) ? targetPath : null;
    }

    const memosDir = this.getMemosDir();
    const targetPath = resolve(memosDir, normalize(sanitizedId));
    return targetPath.startsWith(memosDir) ? targetPath : null;
  }

  async delete(id) {
    await this.#ensureReady();
    const entryPath = this.resolveEntryPath(id);
    if (!entryPath) {
      return { success: false, status: 400, error: "Invalid memo id." };
    }

    try {
      const fileStat = await stat(entryPath);
      if (!fileStat.isFile()) {
        return { success: false, status: 404, error: "Memo not found." };
      }
      await unlink(entryPath);
      return { success: true, status: 200 };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { success: false, status: 404, error: "Memo not found." };
      }
      return {
        success: false,
        status: 500,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  findImagePath(filename) {
    const safeName = basename(String(filename ?? ""));
    if (!safeName) {
      return null;
    }

    const vaultImagePath = join(this.getImagesDir(), safeName);
    if (existsSync(vaultImagePath)) {
      return vaultImagePath;
    }

    return null;
  }
}
