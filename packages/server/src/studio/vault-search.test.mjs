import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatVaultSearchText, searchVault } from "./vault-search.mjs";

async function createVaultFixture() {
  const vaultDir = await mkdtemp(join(tmpdir(), "vault-search-"));

  await mkdir(join(vaultDir, "projects"), { recursive: true });
  await mkdir(join(vaultDir, "learnings"), { recursive: true });
  await mkdir(join(vaultDir, "domains"), { recursive: true });

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

This paragraph mentions nebula-search only in body text.
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

  return vaultDir;
}

describe("vault search", () => {
  const tempDirs = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns entity-only hits for frontmatter title and top-level field matches", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const titleResult = await searchVault({
      vaultDir,
      query: "entity catalog",
    });

    expect(titleResult.entityMatches).toEqual([
      expect.objectContaining({
        path: "projects/entity-catalog.md",
        lineNumber: 2,
        fieldKind: "title",
      }),
    ]);
    expect(titleResult.contentMatches).toEqual([]);

    const fieldResult = await searchVault({
      vaultDir,
      query: "studio-alpha",
    });

    expect(fieldResult.entityMatches).toEqual([
      expect.objectContaining({
        path: "projects/entity-catalog.md",
        lineNumber: 3,
        fieldKind: "frontmatter:project",
      }),
    ]);
    expect(fieldResult.contentMatches).toEqual([]);
  });

  it("returns content-only hits when the query appears only in the body", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "nebula-search",
    });

    expect(result.entityMatches).toEqual([]);
    expect(result.contentMatches).toEqual([
      expect.objectContaining({
        path: "learnings/plain-notes.md",
        lineNumber: 7,
        fieldKind: "body",
      }),
    ]);
  });

  it("keeps block-array frontmatter hits on the original array item line", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "misc",
    });

    expect(result.entityMatches).toEqual([
      expect.objectContaining({
        path: "learnings/plain-notes.md",
        lineNumber: 4,
        fieldKind: "frontmatter:tags",
      }),
    ]);
    expect(result.contentMatches).toEqual([]);
  });

  it("returns both entity and content hits when the same query matches both", async () => {
    const vaultDir = await createVaultFixture();
    tempDirs.push(vaultDir);

    const result = await searchVault({
      vaultDir,
      query: "lotus",
    });

    expect(result.entityMatches).toEqual([
      expect.objectContaining({
        path: "domains/lotus-playbook.md",
        lineNumber: 1,
        fieldKind: "canonical_id",
      }),
    ]);
    expect(result.contentMatches).toEqual([
      expect.objectContaining({
        path: "domains/lotus-playbook.md",
        lineNumber: 6,
        fieldKind: "body",
      }),
    ]);

    const formatted = formatVaultSearchText(result);
    expect(formatted).toContain("## Entity Matches");
    expect(formatted).toContain("## Content Matches");
    expect(formatted).toContain("[canonical_id]");
    expect(formatted).toContain("[body]");
  });
});
