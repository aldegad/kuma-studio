import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { syncVaultSkills } from "./vault-skill-sync.mjs";

async function writeSkillDoc(skillsDir, skillName, fileName, content) {
  const skillDir = join(skillsDir, skillName);
  await mkdir(skillDir, { recursive: true });
  const filePath = join(skillDir, fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("vault-skill-sync", () => {
  it("syncs skill docs into inbox, aligns mapped domain sources, and rewrites the index", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-skill-sync-"));
    const skillsDir = join(tempRoot, "skills");
    const vaultDir = join(tempRoot, "vault");

    const imageSkillPath = await writeSkillDoc(
      skillsDir,
      "image-gen",
      "SKILL.md",
      `# Image Generation\n\nPrompt rules and edit workflow.\n`,
    );
    await writeSkillDoc(
      skillsDir,
      "kuma-picker",
      "skill.md",
      `# Kuma Picker\n\nBrowser capture and automation notes.\n`,
    );

    await mkdir(join(vaultDir, "domains"), { recursive: true });
    await writeFile(
      join(vaultDir, "domains", "image-generation.md"),
      `---
title: 이미지 생성 도메인 운영 가이드
domain: domains
tags: [image-generation]
created: 2026-04-08
updated: 2026-04-08
sources: [${imageSkillPath}, ${imageSkillPath}]
---

## Summary
이미지 생성 운영 문서.

## Details
기존 정리본.

## Related
(교차참조 추가 예정)
`,
      "utf8",
    );

    await writeFile(
      join(vaultDir, "index.md"),
      `# Kuma Vault Index

## Domains
(아직 없음)
`,
      "utf8",
    );

    const result = await syncVaultSkills({
      skillsDir,
      vaultDir,
      now: new Date("2026-04-08T12:00:00.000Z"),
    });

    expect(result.skillsSynced).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.domainPagesUpdated).toBe(1);
    expect(result.dedupedSources).toBeGreaterThanOrEqual(1);
    expect(result.orphanWarnings).toContain("domains/image-generation.md");

    const inboxImageGen = await readFile(join(vaultDir, "inbox", "image-gen.md"), "utf8");
    expect(inboxImageGen).toContain("source: skills/image-gen");
    expect(inboxImageGen).toContain("migrated_to: domains/image-generation.md");
    expect(inboxImageGen).toContain("# Image Generation");

    const inboxPicker = await readFile(join(vaultDir, "inbox", "kuma-picker.md"), "utf8");
    expect(inboxPicker).toContain("source: skills/kuma-picker");
    expect(inboxPicker).toContain("# Kuma Picker");

    const domainPage = await readFile(join(vaultDir, "domains", "image-generation.md"), "utf8");
    expect(domainPage.match(new RegExp(imageSkillPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"))).toHaveLength(1);

    const indexContent = await readFile(join(vaultDir, "index.md"), "utf8");
    expect(indexContent).toContain("[이미지 생성 도메인 운영 가이드](domains/image-generation.md)");
    expect(indexContent).toContain("[Kuma Picker](inbox/kuma-picker.md)");
    expect(indexContent).toContain("image-generation ← skills/image-gen/SKILL.md");
    expect(indexContent).toContain("kuma-picker ← skills/kuma-picker");

    const logContent = await readFile(join(vaultDir, "log.md"), "utf8");
    expect(logContent).toContain("SYNC_SKILLS: 2 skills (2 created, 0 updated, 0 deleted, domain updates: 1)");
    expect(logContent).toContain("WARN: Orphan domain page auto-indexed: domains/image-generation.md");
  });

  it("deletes stale managed inbox entries when a skill disappears", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-skill-sync-"));
    const skillsDir = join(tempRoot, "skills");
    const vaultDir = join(tempRoot, "vault");

    const staleSkillDir = join(skillsDir, "autoresearch");
    await writeSkillDoc(
      skillsDir,
      "autoresearch",
      "SKILL.md",
      `# Autoresearch\n\nRun unattended loops.\n`,
    );

    await syncVaultSkills({
      skillsDir,
      vaultDir,
      now: new Date("2026-04-08T12:00:00.000Z"),
    });
    expect(existsSync(join(vaultDir, "inbox", "autoresearch.md"))).toBe(true);

    await rm(staleSkillDir, { recursive: true, force: true });

    const result = await syncVaultSkills({
      skillsDir,
      vaultDir,
      now: new Date("2026-04-08T13:00:00.000Z"),
    });

    expect(result.skillsSynced).toBe(0);
    expect(result.deleted).toBe(1);
    expect(existsSync(join(vaultDir, "inbox", "autoresearch.md"))).toBe(false);
  });
});
