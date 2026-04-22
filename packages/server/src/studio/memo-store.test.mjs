import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { MemoStore } from "./memo-store.mjs";

const TEMP_ENV_KEYS = ["KUMA_VAULT_DIR", "HOME"];

async function setupMemoEnv() {
  const homeDir = await mkdtemp(join(tmpdir(), "kuma-home-"));
  const vaultDir = join(homeDir, ".kuma", "vault");
  const legacyMemoDir = join(homeDir, ".kuma", "memos");
  process.env.HOME = homeDir;
  process.env.KUMA_VAULT_DIR = vaultDir;
  await mkdir(join(homeDir, ".kuma"), { recursive: true });
  return { homeDir, vaultDir, legacyMemoDir };
}

describe("memo-store", () => {
  afterEach(() => {
    for (const key of TEMP_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("scaffolds vault storage with a canonical memos directory and no demo seed memos", async () => {
    const { vaultDir } = await setupMemoEnv();
    const store = new MemoStore(process.cwd());

    const memos = await store.list();

    expect(memos).toEqual([]);

    const vaultRootEntries = await readdir(vaultDir);
    expect(vaultRootEntries).toEqual(
      expect.arrayContaining([
        "domains",
        "projects",
        "memos",
        "learnings",
        "results",
        "inbox",
        "index.md",
        "schema.md",
        "log.md",
        "images",
      ]),
    );

    expect(await readdir(join(vaultDir, "memos"))).toEqual([]);
  });

  it("migrates legacy memos into vault/memos and drops seeded demo memo artifacts", async () => {
    const { legacyMemoDir, vaultDir } = await setupMemoEnv();
    await mkdir(legacyMemoDir, { recursive: true });
    await Promise.all([
      writeFile(join(legacyMemoDir, "MEMORY.md"), "# legacy index\n"),
      writeFile(
        join(legacyMemoDir, "user-note.md"),
        "---\ntitle: User Note\ncreated: 2026-04-10T00:00:00.000Z\nupdated: 2026-04-10T00:00:00.000Z\nimages: []\n---\n\nhello\n",
      ),
      writeFile(
        join(legacyMemoDir, "bench-euler-grid.md"),
        "---\ntitle: Seed Demo\ncreated: 2026-04-03T01:52:00.000Z\nupdated: 2026-04-03T01:52:00.000Z\nimages: []\n---\n\nseed\n",
      ),
    ]);

    const store = new MemoStore(process.cwd());
    const memos = await store.list();

    expect(memos).toHaveLength(1);
    expect(memos[0]).toMatchObject({
      id: "user-note.md",
      title: "User Note",
      text: "hello",
      source: "vault",
      section: "memos",
    });

    expect(await readdir(join(vaultDir, "memos"))).toEqual(["user-note.md"]);
    expect(await readdir(legacyMemoDir)).toEqual([]);
  });

  it("writes canonical memos into vault/memos and preserves image routes", async () => {
    const { vaultDir } = await setupMemoEnv();
    const store = new MemoStore(process.cwd());

    const created = await store.add({
      title: "위키 문서",
      text: "hello\nvault",
      images: ["/studio/memo-images/lightning-warm.png"],
    });

    const saved = await readFile(join(vaultDir, "memos", created.id), "utf8");

    expect(created.section).toBe("memos");
    expect(created.source).toBe("vault");
    expect(saved).toContain("title: 위키 문서");
    expect(saved).toContain("updated:");
    expect(saved).toContain("images: [lightning-warm.png]");
    expect(saved).toContain("hello\nvault");
    expect(created.images).toEqual(["/studio/memo-images/lightning-warm.png"]);

    const memos = await store.list();
    expect(memos.some((memo) => memo.id === created.id)).toBe(true);

    const deleted = await store.delete(created.id);
    expect(deleted.success).toBe(true);
  });

  it("lists memo files only from vault/memos and ignores other vault pages", async () => {
    const { vaultDir } = await setupMemoEnv();
    const store = new MemoStore(process.cwd());
    await store.list();

    await Promise.all([
      writeFile(
        join(vaultDir, "memos", "user-note.md"),
        "---\ntitle: User Note\ncreated: 2026-04-10T00:00:00.000Z\nupdated: 2026-04-10T00:00:00.000Z\nimages: []\n---\n\nhello\n",
      ),
      writeFile(join(vaultDir, "current-focus.md"), "---\ntitle: Current Focus\n---\n"),
      mkdir(join(vaultDir, "domains"), { recursive: true }),
      writeFile(join(vaultDir, "domains", "security.md"), "---\ntitle: Security\n---\n"),
    ]);

    const memos = await store.list();

    expect(memos).toHaveLength(1);
    expect(memos[0]?.id).toBe("user-note.md");
    expect(memos.every((memo) => memo.source === "vault" && memo.section === "memos")).toBe(true);
  });

  it("parses memo frontmatter arrays and trims memo body", async () => {
    const { vaultDir } = await setupMemoEnv();
    const store = new MemoStore(process.cwd());
    await store.list();

    await writeFile(
      join(vaultDir, "memos", "shared-parser.md"),
      [
        "---",
        'title: "Quoted 제목"',
        "created: 2026-04-11T09:00:00.000Z",
        "updated: 2026-04-11T09:30:00.000Z",
        'images: ["first.png", "second.png"]',
        "---",
        "",
        "",
        "  body content  ",
        "",
      ].join("\n"),
      "utf8",
    );

    const memos = await store.list();
    const parsed = memos.find((memo) => memo.id === "shared-parser.md");

    expect(parsed).toBeDefined();
    expect(parsed?.title).toBe("Quoted 제목");
    expect(parsed?.createdAt).toBe("2026-04-11T09:00:00.000Z");
    expect(parsed?.text).toBe("body content");
    expect(parsed?.images).toEqual([
      "/studio/memo-images/first.png",
      "/studio/memo-images/second.png",
    ]);
  });

  it("falls back to derived title and mtime when frontmatter is missing", async () => {
    const { vaultDir } = await setupMemoEnv();
    const store = new MemoStore(process.cwd());
    await store.list();

    await writeFile(
      join(vaultDir, "memos", "no-frontmatter_note.md"),
      "\n\nplain body only\n\n",
      "utf8",
    );

    const memos = await store.list();
    const bare = memos.find((memo) => memo.id === "no-frontmatter_note.md");

    expect(bare).toBeDefined();
    expect(bare?.title).toBe("no frontmatter note");
    expect(bare?.text).toBe("plain body only");
    expect(bare?.images).toEqual([]);
    expect(typeof bare?.createdAt).toBe("string");
    expect(bare?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });
});
