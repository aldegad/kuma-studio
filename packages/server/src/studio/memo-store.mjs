import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, normalize, relative, resolve } from "node:path";
import { homedir } from "node:os";

const MEMO_IMAGE_ROUTE_PREFIX = "/studio/memo-images/";
const VAULT_SYSTEM_FILE_NAMES = new Set(["index.md", "schema.md", "log.md"]);
const VAULT_ENTRY_SKIP_DIRS = new Set(["images", "inbox"]);
const INBOX_ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json", ".log"]);

const VAULT_SCAFFOLD_FILES = {
  "index.md": "# Kuma Vault\n\n- domains/\n- projects/\n- learnings/\n- inbox/\n",
  "schema.md": "# Vault Schema\n\n- title\n- created\n- tags(optional)\n- body\n",
  "log.md": "# Vault Log\n\n- 2026-04-07 vault scaffold initialized\n",
};

const VAULT_SCAFFOLD_DIRS = ["domains", "projects", "learnings", "inbox"];

const SEED_MEMOS = [
  {
    id: "bench-sdxl-vs-hyper",
    title: "SDXL vs Hyper-SD 벤치마크",
    createdAt: "2026-04-03T01:50:00.000Z",
    text: "동일 모델(amanatsu v11) 640×960\nLightning(4step,euler_a,cfg1.5): 웜 22.1s\nHyper-SD(2step,euler,cfg1.0): 웜 6.0s → 73% 빠름",
    images: ["lightning-warm.png", "hyper-warm.png"],
  },
  {
    id: "bench-euler-grid",
    title: "Hyper-SD euler 그리드 (12장)",
    createdAt: "2026-04-03T01:52:00.000Z",
    text: "step(1,2,4) × cfg(0.5,1.0,1.5,2.0)\n모델: amanatsu v11, 640×960, seed=42",
    images: [
      "euler-s1-cfg0.5.png",
      "euler-s1-cfg1.png",
      "euler-s1-cfg1.5.png",
      "euler-s1-cfg2.png",
      "euler-s2-cfg0.5.png",
      "euler-s2-cfg1.png",
      "euler-s2-cfg1.5.png",
      "euler-s2-cfg2.png",
      "euler-s4-cfg0.5.png",
      "euler-s4-cfg1.png",
      "euler-s4-cfg1.5.png",
      "euler-s4-cfg2.png",
    ],
  },
  {
    id: "bench-euler_a-grid",
    title: "Hyper-SD euler_a 그리드 (12장)",
    createdAt: "2026-04-03T01:55:00.000Z",
    text: "step(1,2,4) × cfg(0.5,1.0,1.5,2.0)\n최종 선택: euler_a / 4step / cfg1.5",
    images: [
      "euler_a-s1-cfg0.5.png",
      "euler_a-s1-cfg1.png",
      "euler_a-s1-cfg1.5.png",
      "euler_a-s1-cfg2.png",
      "euler_a-s2-cfg0.5.png",
      "euler_a-s2-cfg1.png",
      "euler_a-s2-cfg1.5.png",
      "euler_a-s2-cfg2.png",
      "euler_a-s4-cfg0.5.png",
      "euler_a-s4-cfg1.png",
      "euler_a-s4-cfg1.5.png",
      "euler_a-s4-cfg2.png",
    ],
  },
  {
    id: "token-efficiency-report-2026-04-06",
    title: "쿠마팀 토큰 효율 리포트 (2026-04-06)",
    createdAt: "2026-04-06T09:00:00.000Z",
    text: "cmux 위임 구조 토큰 절약 증거\n오늘: 627.6M / 4,139 메시지 (메시지당 ~152K)\n이번달: 307.8M / 2,737 메시지 / $229 (메시지당 ~112K)",
    images: [
      "token-efficiency-2026-04-06-today.png",
      "token-efficiency-2026-04-06-monthly.png",
    ],
  },
];

function normalizeFrontmatterValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseMemoFrontmatter(content = "") {
  const safeContent = typeof content === "string" ? content : "";
  if (safeContent.trim().length === 0) {
    return { frontmatter: {}, body: "" };
  }

  const lines = safeContent.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: safeContent.trim() };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return { frontmatter: {}, body: safeContent.trim() };
  }

  const frontmatter = Object.create(null);
  let currentArrayKey = null;

  for (const rawLine of lines.slice(1, closingIndex)) {
    const line = rawLine.trimEnd();
    const arrayItem = line.match(/^\s*-\s*(.+)$/u);
    if (currentArrayKey && arrayItem) {
      frontmatter[currentArrayKey].push(normalizeFrontmatterValue(arrayItem[1]));
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!match) {
      currentArrayKey = null;
      continue;
    }

    const [, key, rawValue] = match;
    if (rawValue.trim() === "") {
      frontmatter[key] = [];
      currentArrayKey = key;
      continue;
    }

    currentArrayKey = null;
    frontmatter[key] = normalizeFrontmatterValue(rawValue);
  }

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join("\n").trim(),
  };
}

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
  const imageLines = memo.images.map((image) => `  - ${image}`).join("\n");
  const body = memo.text?.trim() ?? "";
  return `---\ntitle: ${memo.title}\ncreated: ${memo.createdAt}\nimages:\n${imageLines}\n---\n\n${body}\n`;
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
 * Priority: KUMA_VAULT_DIR > KUMA_WIKI_DIR > ~/.kuma/vault
 */
export function resolveVaultDir() {
  if (process.env.KUMA_VAULT_DIR) {
    return resolve(process.env.KUMA_VAULT_DIR);
  }

  if (process.env.KUMA_WIKI_DIR) {
    return resolve(process.env.KUMA_WIKI_DIR);
  }

  return resolve(homedir(), ".kuma", "vault");
}

/**
 * Resolve the legacy memo directory.
 * Priority: KUMA_MEMOS_DIR > ~/.kuma/memos
 */
export function resolveLegacyMemosDir() {
  if (process.env.KUMA_MEMOS_DIR) {
    return resolve(process.env.KUMA_MEMOS_DIR);
  }

  return resolve(homedir(), ".kuma", "memos");
}

export function resolveMemosDir() {
  return resolveLegacyMemosDir();
}

export function resolveVaultImagesDir() {
  return join(resolveVaultDir(), "images");
}

export function resolveMemoImagesDir() {
  return resolveVaultImagesDir();
}

export function resolveLegacyMemoImagesDir() {
  return join(resolveLegacyMemosDir(), "images");
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
  #root;
  #ensurePromise = null;

  constructor(root) {
    this.#root = resolve(root);
  }

  getVaultDir() {
    return resolveVaultDir();
  }

  getMemoDir() {
    return this.getVaultDir();
  }

  getLegacyMemoDir() {
    return resolveLegacyMemosDir();
  }

  getInboxDir() {
    return join(this.getMemoDir(), "inbox");
  }

  getImagesDir() {
    return resolveVaultImagesDir();
  }

  getLegacyImagesDir() {
    return resolveLegacyMemoImagesDir();
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

  async #copySeedImagesInto(targetDir) {
    const publicImagesDir = join(this.#root, "packages", "studio-web", "public", "memo-images");
    if (!existsSync(publicImagesDir)) {
      return;
    }

    const imageNames = await readdir(publicImagesDir);
    for (const imageName of imageNames) {
      const sourcePath = join(publicImagesDir, imageName);
      const targetPath = join(targetDir, imageName);
      if (!existsSync(targetPath)) {
        await copyFile(sourcePath, targetPath);
      }
    }
  }

  async #mirrorLegacyImagesIntoVault() {
    const legacyImagesDir = this.getLegacyImagesDir();
    const vaultImagesDir = this.getImagesDir();
    if (!existsSync(legacyImagesDir)) {
      return;
    }

    const imageNames = await readdir(legacyImagesDir);
    for (const imageName of imageNames) {
      const sourcePath = join(legacyImagesDir, imageName);
      const targetPath = join(vaultImagesDir, imageName);
      if (!existsSync(targetPath)) {
        await copyFile(sourcePath, targetPath);
      }
    }
  }

  async #ensureSeedData() {
    const vaultDir = this.getVaultDir();
    const inboxDir = this.getInboxDir();
    const vaultImagesDir = this.getImagesDir();
    const legacyMemoDir = this.getLegacyMemoDir();
    const legacyImagesDir = this.getLegacyImagesDir();

    await mkdir(vaultDir, { recursive: true });
    await mkdir(inboxDir, { recursive: true });
    await mkdir(vaultImagesDir, { recursive: true });
    await mkdir(legacyMemoDir, { recursive: true });
    await mkdir(legacyImagesDir, { recursive: true });

    for (const dirName of VAULT_SCAFFOLD_DIRS) {
      await mkdir(join(vaultDir, dirName), { recursive: true });
    }

    for (const [filename, content] of Object.entries(VAULT_SCAFFOLD_FILES)) {
      const targetPath = join(vaultDir, filename);
      if (!existsSync(targetPath)) {
        await writeFile(targetPath, content, "utf8");
      }
    }

    await this.#copySeedImagesInto(vaultImagesDir);
    await this.#copySeedImagesInto(legacyImagesDir);
    await this.#mirrorLegacyImagesIntoVault();

    for (const memo of SEED_MEMOS) {
      const memoPath = join(legacyMemoDir, `${memo.id}.md`);
      if (!existsSync(memoPath)) {
        await writeFile(memoPath, toMemoMarkdown(memo), "utf8");
      }
    }
  }

  async #readEntryFile(fullPath, rootDir, { source, section, prefix = "" }) {
    const relativePath = normalizeRelativePath(relative(rootDir, fullPath));
    const stats = await stat(fullPath);
    const extension = extname(fullPath).toLowerCase();
    const entryId = `${prefix}${relativePath}`;
    const content = await readFile(fullPath, "utf8");

    if (extension === ".md") {
      const { frontmatter, body } = parseMemoFrontmatter(content);
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

  async #readVaultEntries() {
    const vaultDir = this.getVaultDir();
    const files = await walkFiles(vaultDir, {
      recursive: true,
      allowedExtensions: new Set([".md"]),
      skipDirNames: VAULT_ENTRY_SKIP_DIRS,
    });

    const entries = [];
    for (const file of files) {
      const relativePath = normalizeRelativePath(relative(vaultDir, file));
      if (VAULT_SYSTEM_FILE_NAMES.has(basename(relativePath))) {
        continue;
      }
      entries.push(await this.#readEntryFile(file, vaultDir, { source: "vault", section: "vault" }));
    }
    return entries;
  }

  async #readLegacyEntries() {
    const legacyMemoDir = this.getLegacyMemoDir();
    const files = await walkFiles(legacyMemoDir, {
      recursive: false,
      allowedExtensions: new Set([".md"]),
    });

    const entries = [];
    for (const file of files) {
      entries.push(await this.#readEntryFile(file, legacyMemoDir, {
        source: "legacy-memo",
        section: "vault",
        prefix: "legacy/",
      }));
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
      entries.push(await this.#readEntryFile(file, this.getMemoDir(), {
        source: "vault",
        section: "inbox",
      }));
    }
    return entries;
  }

  async list() {
    await this.#ensureReady();
    const [vaultEntries, legacyEntries] = await Promise.all([
      this.#readVaultEntries(),
      this.#readLegacyEntries(),
    ]);
    return sortMemosDesc([...vaultEntries, ...legacyEntries]);
  }

  async listMemos() {
    await this.#ensureReady();
    return sortMemosDesc(await this.#readLegacyEntries());
  }

  async listInbox() {
    await this.#ensureReady();
    return sortMemosDesc(await this.#readInboxEntries());
  }

  async add(input) {
    await this.#ensureReady();

    const fileName = `${randomUUID()}.md`;
    const createdAt = new Date().toISOString();
    const memo = {
      title: String(input?.title ?? "").trim(),
      text: typeof input?.text === "string" ? input.text.trim() : "",
      images: Array.isArray(input?.images)
        ? input.images.map((image) => toMemoImageFilename(image)).filter(Boolean)
        : [],
      createdAt,
    };

    await writeFile(join(this.getMemoDir(), fileName), toMemoMarkdown(memo), "utf8");

    return {
      id: fileName,
      path: fileName,
      title: memo.title,
      text: memo.text || undefined,
      images: memo.images.map((image) => memoImageUrl(image)),
      createdAt,
      source: "vault",
      section: "vault",
    };
  }

  async addInbox(input) {
    await this.#ensureReady();

    const fileName = `${randomUUID()}.md`;
    const createdAt = new Date().toISOString();
    const title = String(input?.title ?? "").trim() || "Inbox";
    const memo = {
      title,
      text: typeof input?.text === "string" ? input.text.trim() : "",
      images: [],
      createdAt,
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

    if (sanitizedId.startsWith("legacy/")) {
      const relativeLegacyPath = sanitizedId.slice("legacy/".length);
      const targetPath = resolve(this.getLegacyMemoDir(), normalize(relativeLegacyPath));
      return targetPath.startsWith(this.getLegacyMemoDir()) ? targetPath : null;
    }

    const targetPath = resolve(this.getMemoDir(), normalize(sanitizedId));
    return targetPath.startsWith(this.getMemoDir()) ? targetPath : null;
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

    const legacyImagePath = join(this.getLegacyImagesDir(), safeName);
    if (existsSync(legacyImagePath)) {
      return legacyImagePath;
    }

    return null;
  }
}
