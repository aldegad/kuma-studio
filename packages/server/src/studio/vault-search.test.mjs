import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { formatVaultGetText, formatVaultSearchText, getVaultDocuments, searchVault } from "./vault-search.mjs";

const execFile = promisify(execFileCallback);
const CLI_PATH = resolve(process.cwd(), "packages/server/src/cli.mjs");
const VAULT_BIN_PATH = resolve(process.cwd(), "scripts/bin/vault");

async function createVaultFixture() {
  const vaultDir = await mkdtemp(join(tmpdir(), "vault-search-"));

  await mkdir(join(vaultDir, "projects"), { recursive: true });
  await mkdir(join(vaultDir, "memos"), { recursive: true });
  await mkdir(join(vaultDir, "learnings"), { recursive: true });
  await mkdir(join(vaultDir, "domains"), { recursive: true });

  await writeFile(
    join(vaultDir, "memos", "favorite-stack.md"),
    `---
title: Favorite Stack
created: 2026-04-20T09:00:00.000Z
updated: 2026-04-20T09:30:00.000Z
images: []
---

alpha-suite와 kuma-studio를 자주 같이 본다.
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "projects", "entity-catalog.md"),
    `---
title: Entity Catalog
project: studio-alpha
owner: tookdaki
---

Plain background notes only.
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "learnings", "plain-notes.md"),
    `---
title: General Notes
tags:
  - misc
---

Intro line before the match.
This paragraph mentions nebula-search only in body text.
Follow-up line after the body match.
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "domains", "security.md"),
    `---
title: Security
aliases:
  - vault shield
---

Vault security baseline checklist.
Never dump the full document from search results.
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "domains", "lotus-playbook.md"),
    `---
title: Migration Playbook
project: kuma-studio
---

Lotus rollout notes are tracked here.
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "domains", "alex-accounts.md"),
    `---
title: 알렉스 SNS/플랫폼 계정 레지스트리
aliases:
  - 내 계정
  - 내 아이디
  - 알렉스 계정
  - 권효성
  - hyoseoung
  - hyoseoung2002
---

알렉스(수홍, 쿠마 스튜디오 운영자)의 개인/운영 SNS 계정과 핸들 모음.
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "learnings", "generic-id-note.md"),
    `---
title: Generic ID Note
---

아이디만 적힌 메모.
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "index.md"),
    "# Vault Index\n\n- security\n",
    "utf8",
  );

  return vaultDir;
}

describe("vault search", () => {
  const tempDirs = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns aggregated L1 hits with stable ids and snippets", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "lotus",
    });

    expect(result.mode).toBe("search");
    expect(result.entityMatchCount).toBe(1);
    expect(result.contentMatchCount).toBe(1);
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "domains/lotus-playbook.md",
        path: "domains/lotus-playbook.md",
        title: "Migration Playbook",
        entityMatchCount: 1,
        contentMatchCount: 1,
      }),
    ]);

    const formatted = formatVaultSearchText(result);
    expect(formatted).toContain("# /vault search");
    expect(formatted).toContain("id: domains/lotus-playbook.md");
    expect(formatted).not.toContain("## Content Matches");
    expect(formatted).not.toContain("Lotus rollout notes are tracked here.\nLotus rollout notes are tracked here.");
  });

  it("returns explicit no matches when nothing is found", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "does-not-exist",
    });

    expect(result.hits).toEqual([]);
    expect(formatVaultSearchText(result)).toContain("no matches");
  });

  it("searches canonical vault memos without a separate memo backend", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "alpha-suite",
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "memos/favorite-stack.md",
        path: "memos/favorite-stack.md",
        title: "Favorite Stack",
      }),
    ]);
  });

  it("returns timeline snippets without dumping the full document", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "nebula-search",
      mode: "timeline",
    });

    expect(result.mode).toBe("timeline");
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "learnings/plain-notes.md",
        path: "learnings/plain-notes.md",
        contentMatchCount: 1,
        snippets: [
          expect.objectContaining({
            lineNumber: 8,
            startLine: 6,
            endLine: 10,
          }),
        ],
      }),
    ]);

    const formatted = formatVaultSearchText(result);
    expect(formatted).toContain("# /vault timeline");
    expect(formatted).toContain("timeline_1: L6-L10");
    expect(formatted).toContain("L8: This paragraph mentions nebula-search only in body text.");
    expect(formatted).not.toContain("## Entity Matches");
  });

  it("preserves alias retrieval for framed natural-language queries", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "내 권효성 아이디 알려줘",
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "domains/alex-accounts.md",
        title: "알렉스 SNS/플랫폼 계정 레지스트리",
        entityMatchCount: 1,
      }),
    ]);
  });

  it("loads full document contents only through vault get", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await getVaultDocuments({
      vaultDir,
      ids: ["domains/security.md", "domains/lotus-playbook.md"],
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "domains/security.md",
        path: "domains/security.md",
        title: "Security",
      }),
      expect.objectContaining({
        id: "domains/lotus-playbook.md",
        path: "domains/lotus-playbook.md",
        title: "Migration Playbook",
      }),
    ]);

    const formatted = formatVaultGetText(result);
    expect(formatted).toContain("# /vault get");
    expect(formatted).toContain("Vault security baseline checklist.");
    expect(formatted).toContain("Lotus rollout notes are tracked here.");
  });

  it("exposes vault-search CLI modes and vault-get at the cli.mjs level", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const { stdout: searchStdout } = await execFile("node", [
      CLI_PATH,
      "vault-search",
      "--mode",
      "search",
      "--vault-dir",
      vaultDir,
      "--query",
      "vault",
    ]);
    expect(searchStdout).toContain("# /vault search");
    expect(searchStdout).toContain("id: domains/security.md");
    expect(searchStdout).not.toContain("Vault security baseline checklist.\nNever dump the full document from search results.");

    const { stdout: timelineStdout } = await execFile("node", [
      CLI_PATH,
      "vault-search",
      "--mode",
      "timeline",
      "--vault-dir",
      vaultDir,
      "--query",
      "vault",
    ]);
    expect(timelineStdout).toContain("# /vault timeline");
    expect(timelineStdout).toContain("timeline_1:");

    const { stdout: getStdout } = await execFile("node", [
      CLI_PATH,
      "vault-get",
      "--vault-dir",
      vaultDir,
      "domains/security.md",
    ]);
    expect(getStdout).toContain("# /vault get");
    expect(getStdout).toContain("Vault security baseline checklist.");
  });

  it("keeps the vault domain shortcut working through the bin wrapper", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const { stdout } = await execFile("bash", [
      VAULT_BIN_PATH,
      "--vault-dir",
      vaultDir,
      "security",
    ]);

    expect(stdout).toContain("title: Security");
    expect(stdout).toContain("Vault security baseline checklist.");
  });
});
