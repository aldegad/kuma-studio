import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoStore } from "./memo-store.mjs";

const TEMP_ENV_KEYS = ["KUMA_VAULT_DIR", "KUMA_USER_MEMO_DIR"];

async function setupMemoEnv() {
  process.env.KUMA_VAULT_DIR = await mkdtemp(join(tmpdir(), "kuma-vault-"));
  process.env.KUMA_USER_MEMO_DIR = await mkdtemp(join(tmpdir(), "kuma-user-memo-"));
}

describe("memo-store", () => {
  afterEach(() => {
    for (const key of TEMP_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("scaffolds vault storage and seeds canonical vault memos", async () => {
    await setupMemoEnv();
    const store = new MemoStore(process.cwd());

    const memos = await store.list();

    expect(memos).toHaveLength(4);
    expect(memos[0]?.id).toBe("token-efficiency-report-2026-04-06.md");
    expect(memos[0]?.source).toBe("user-memo");
    expect(memos[0]?.images).toContain("/studio/memo-images/token-efficiency-2026-04-06-today.png");

    const userMemoEntries = await readdir(process.env.KUMA_USER_MEMO_DIR);
    expect(userMemoEntries).toEqual(
      expect.arrayContaining([
        "bench-sdxl-vs-hyper.md",
        "token-efficiency-report-2026-04-06.md",
      ]),
    );

    const vaultRootEntries = await readdir(process.env.KUMA_VAULT_DIR);
    expect(vaultRootEntries).toEqual(
      expect.arrayContaining([
        "domains",
        "projects",
        "learnings",
        "results",
        "inbox",
        "index.md",
        "schema.md",
        "log.md",
        "images",
      ]),
    );
  });

  it("writes user memos into the user-memo root and preserves image routes", async () => {
    await setupMemoEnv();
    const store = new MemoStore(process.cwd());

    const created = await store.add({
      title: "위키 문서",
      text: "hello\nvault",
      images: ["/studio/memo-images/lightning-warm.png"],
    });

    const saved = await readFile(join(process.env.KUMA_USER_MEMO_DIR, created.id), "utf8");

    expect(created.section).toBe("user-memo");
    expect(created.source).toBe("user-memo");
    expect(saved).toContain("title: 위키 문서");
    expect(saved).toContain("hello\nvault");
    expect(saved).toContain("  - lightning-warm.png");
    expect(created.images).toEqual(["/studio/memo-images/lightning-warm.png"]);

    const memos = await store.list();
    expect(memos.some((memo) => memo.id === created.id)).toBe(true);

    const deleted = await store.delete(created.id);
    expect(deleted.success).toBe(true);
  });

  it("writes inbox entries separately from vault pages", async () => {
    await setupMemoEnv();
    const store = new MemoStore(process.cwd());

    const created = await store.addInbox({
      title: "원문",
      text: "{\"raw\":true}",
    });

    expect(created.id.startsWith("inbox/")).toBe(true);
    expect(created.section).toBe("inbox");

    const inboxFileName = created.id.slice("inbox/".length);
    const saved = await readFile(join(process.env.KUMA_VAULT_DIR, "inbox", inboxFileName), "utf8");
    expect(saved).toContain("title: 원문");
    expect(saved).toContain("{\"raw\":true}");

    const inboxEntries = await store.listInbox();
    expect(inboxEntries.map((entry) => entry.id)).toContain(created.id);

    const vaultEntries = await store.list();
    expect(vaultEntries.map((entry) => entry.id)).not.toContain(created.id);
  });

  it("lists user-memo files only, excludes MEMORY.md, and ignores vault files", async () => {
    await setupMemoEnv();
    const store = new MemoStore(process.cwd());
    await store.list();

    await Promise.all([
      writeFile(join(process.env.KUMA_USER_MEMO_DIR, "MEMORY.md"), "# memory index\n"),
      writeFile(join(process.env.KUMA_USER_MEMO_DIR, "user-note.md"), "---\ntitle: User Note\ncreated: 2026-04-10T00:00:00.000Z\n---\n\nhello\n"),
      writeFile(join(process.env.KUMA_VAULT_DIR, "token-efficiency-report-2026-04-06.md"), "---\ntitle: Wrong Vault Source\n---\n"),
      writeFile(join(process.env.KUMA_VAULT_DIR, "current-focus.md"), "---\ntitle: Current Focus\n---\n"),
      writeFile(join(process.env.KUMA_VAULT_DIR, "domains", "security.md"), "---\ntitle: Security\n---\n"),
    ]);

    const memos = await store.list();

    expect(memos).toHaveLength(5);
    expect(memos.map((memo) => memo.id)).toEqual(expect.arrayContaining([
      "bench-sdxl-vs-hyper.md",
      "bench-euler-grid.md",
      "bench-euler_a-grid.md",
      "token-efficiency-report-2026-04-06.md",
      "user-note.md",
    ]));
    expect(memos.map((memo) => memo.id)).not.toEqual(expect.arrayContaining([
      "MEMORY.md",
      "current-focus.md",
      "domains/security.md",
    ]));
    expect(memos.every((memo) => memo.source === "user-memo")).toBe(true);
  });

  it("parses frontmatter arrays, quoted values, and trims body when reading user memos", async () => {
    await setupMemoEnv();
    const store = new MemoStore(process.cwd());
    await store.list();

    const memoPath = join(process.env.KUMA_USER_MEMO_DIR, "shared-parser.md");
    const content = [
      "---",
      'title: "Quoted 제목"',
      "created: 2026-04-11T09:00:00.000Z",
      "images:",
      "  - first.png",
      '  - "second.png"',
      "---",
      "",
      "",
      "  body content  ",
      "",
      "",
    ].join("\n");
    await writeFile(memoPath, content, "utf8");

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

  it("falls back to derived title and mtime when frontmatter is missing, and trims bare body", async () => {
    await setupMemoEnv();
    const store = new MemoStore(process.cwd());
    await store.list();

    await writeFile(
      join(process.env.KUMA_USER_MEMO_DIR, "no-frontmatter_note.md"),
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

  it("seeds user-memo files only once even when list() runs multiple times", async () => {
    await setupMemoEnv();
    const store = new MemoStore(process.cwd());

    await store.list();
    await store.list();

    const entries = await readdir(process.env.KUMA_USER_MEMO_DIR);
    expect(entries.filter((name) => name === "bench-sdxl-vs-hyper.md")).toHaveLength(1);
    expect(entries.filter((name) => name === "bench-euler-grid.md")).toHaveLength(1);
    expect(entries.filter((name) => name === "bench-euler_a-grid.md")).toHaveLength(1);
    expect(entries.filter((name) => name === "token-efficiency-report-2026-04-06.md")).toHaveLength(1);
  });
});
