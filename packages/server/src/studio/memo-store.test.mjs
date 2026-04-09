import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoStore } from "./memo-store.mjs";

const TEMP_ENV_KEYS = ["KUMA_VAULT_DIR"];

describe("memo-store", () => {
  afterEach(() => {
    for (const key of TEMP_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("scaffolds vault storage and seeds canonical vault memos", async () => {
    process.env.KUMA_VAULT_DIR = await mkdtemp(join(tmpdir(), "kuma-vault-"));
    const store = new MemoStore(process.cwd());

    const memos = await store.list();

    expect(memos).toHaveLength(4);
    expect(memos[0]?.id).toBe("token-efficiency-report-2026-04-06.md");
    expect(memos[0]?.source).toBe("vault");
    expect(memos[0]?.images).toContain("/studio/memo-images/token-efficiency-2026-04-06-today.png");

    const vaultRootEntries = await readdir(process.env.KUMA_VAULT_DIR);
    expect(vaultRootEntries).toEqual(
      expect.arrayContaining([
        "domains",
        "projects",
        "learnings",
        "inbox",
        "index.md",
        "schema.md",
        "log.md",
        "images",
        "bench-sdxl-vs-hyper.md",
        "token-efficiency-report-2026-04-06.md",
      ]),
    );
  });

  it("writes vault entries into the vault root and preserves image routes", async () => {
    process.env.KUMA_VAULT_DIR = await mkdtemp(join(tmpdir(), "kuma-vault-"));
    const store = new MemoStore(process.cwd());

    const created = await store.add({
      title: "위키 문서",
      text: "hello\nvault",
      images: ["/studio/memo-images/lightning-warm.png"],
    });

    const saved = await readFile(join(process.env.KUMA_VAULT_DIR, created.id), "utf8");

    expect(created.section).toBe("vault");
    expect(created.source).toBe("vault");
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
    process.env.KUMA_VAULT_DIR = await mkdtemp(join(tmpdir(), "kuma-vault-"));
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
});
