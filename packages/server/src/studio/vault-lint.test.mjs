import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { lintVaultFiles } from "./vault-lint.mjs";

const execFile = promisify(execFileCallback);
const CLI_PATH = resolve(process.cwd(), "packages/server/src/cli.mjs");

async function writeVaultLintFixture(vaultDir) {
  await mkdir(vaultDir, { recursive: true });

  await writeFile(
    join(vaultDir, "schema.md"),
    `---
title: Kuma Wiki Schema
description: Wiki 페이지 작성 규칙과 운영 원칙
---

# Kuma Wiki Schema

## Special Files

### 1) \`dispatch-log.md\`

- **Primary writer:** \`kuma-task lifecycle hook\`
- **Frontmatter type 표준:** \`type: special/dispatch-log\`

### 2) \`decisions.md\`

- **Primary writer:** \`user-direct\`
- **Frontmatter type 표준:** \`type: special/decisions\`
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "dispatch-log.md"),
    `---
title: Dispatch Log
type: special/dispatch-log
updated: 2026-04-09T09:00:23Z
entry_format: append-only-ledger
source_of_truth: kuma-task-lifecycle
boot_priority: 1
---

## Entries
- 2026-04-09T09:00:23Z | project=kuma-studio | task_id=darami-20260409-190014 | worker=surface:5 | qa=worker-self-report | signal=kuma-studio-darami-20260409-190014-done | state=dispatched
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "decisions.md"),
    `---
title: Decisions
type: special/decisions
updated: 2026-04-09T09:00:23Z
entry_rule: explicit-user-decision-only
source_of_truth: user-direct
boot_priority: 3
---

## About

fixture

## Decisions
- [Dispatch Log](dispatch-log.md) 를 boot pack 에 포함할지 검토
`,
    "utf8",
  );
}

describe("vault lint", () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("passes fast lint across all special files within the smoke budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await writeVaultLintFixture(vaultDir);

    const result = lintVaultFiles({ vaultDir, mode: "fast" });

    expect(result.ok).toBe(true);
    expect(result.issueCount).toBe(0);
    expect(result.fileCount).toBe(2);
    expect(result.durationMs).toBeLessThan(100);
  });

  it("fails fast lint when a frontmatter type is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await writeVaultLintFixture(vaultDir);

    await writeFile(
      join(vaultDir, "decisions.md"),
      `---
title: Decisions
type: special/decisions
updated: 2026-04-09T09:00:23Z
entry_rule: explicit-user-decision-only
source_of_truth: user-direct
boot_priority: nope
---

## About

fixture

## Decisions
(비어 있음)
`,
      "utf8",
    );

    const result = lintVaultFiles({ vaultDir, mode: "fast" });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.file === "decisions.md" && issue.code === "frontmatter-type-mismatch")).toBe(true);
  });

  it("passes full lint when schema, sections, and links are valid", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await writeVaultLintFixture(vaultDir);

    const result = lintVaultFiles({ vaultDir, mode: "full" });

    expect(result.ok).toBe(true);
    expect(result.issueCount).toBe(0);
  });

  it("supports ingest follow-up lint for generic pages plus index/log", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await mkdir(join(vaultDir, "domains"), { recursive: true });
    await writeVaultLintFixture(vaultDir);

    await writeFile(
      join(vaultDir, "domains", "security.md"),
      `---
title: Security
domain: domains
tags: [security]
created: 2026-04-16
updated: 2026-04-16
sources: [https://example.com/security]
---

## Summary
보안 도메인 요약.

## Details
세부 운영 원칙.

## Related
- [Dispatch Log](../dispatch-log.md) — 런타임 증적과 연결
`,
      "utf8",
    );

    await writeFile(
      join(vaultDir, "index.md"),
      `# Kuma Vault Index

## Domains
- [Security](domains/security.md) — 보안 지식

## Projects
(비어 있음)

## Learnings
(비어 있음)

## Results
(아직 없음)

## Inbox
(비어 있음)

## Cross References
- Security → dispatch-log
`,
      "utf8",
    );

    await writeFile(
      join(vaultDir, "log.md"),
      `# Kuma Vault Change Log

## 2026-04-16
- INGEST: \`security-note.md\` → \`domains/security.md\` (qa: passed)
`,
      "utf8",
    );

    const result = lintVaultFiles({
      vaultDir,
      mode: "fast",
      files: ["domains/security.md", "index.md", "log.md"],
    });

    expect(result.ok).toBe(true);
    expect(result.issueCount).toBe(0);
    expect(result.fileCount).toBe(3);
  });

  it("reports legacy ingest markers inside project summary pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await mkdir(join(vaultDir, "projects"), { recursive: true });
    await writeVaultLintFixture(vaultDir);

    await writeFile(
      join(vaultDir, "projects", "kuma-studio.md"),
      `---
title: kuma-studio 프로젝트 지식
domain: projects
tags: [studio]
created: 2026-04-16
updated: 2026-04-16
sources: []
---

## Summary
쿠마 스튜디오 요약.

## Details
<!-- ingest:qa-auto-ingest:start -->
legacy result merge
<!-- ingest:qa-auto-ingest:end -->

## Related
(비어 있음)
`,
      "utf8",
    );

    const result = lintVaultFiles({
      vaultDir,
      mode: "full",
      files: ["projects/kuma-studio.md"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.file === "projects/kuma-studio.md" && issue.code === "project-ingest-marker")).toBe(true);
  });

  it("reports result archives leaking into project summary frontmatter sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await mkdir(join(vaultDir, "projects"), { recursive: true });
    await writeVaultLintFixture(vaultDir);

    await writeFile(
      join(vaultDir, "projects", "kuma-studio.md"),
      `---
title: kuma-studio 프로젝트 지식
domain: projects
tags: [studio]
created: 2026-04-16
updated: 2026-04-16
sources: ["results/qa-auto-ingest.result.md"]
---

## Summary
쿠마 스튜디오 요약.

## Details
현재 상태.

## Related
(비어 있음)
`,
      "utf8",
    );

    const result = lintVaultFiles({
      vaultDir,
      mode: "full",
      files: ["projects/kuma-studio.md"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.file === "projects/kuma-studio.md" && issue.code === "project-result-sources")).toBe(true);
  });

  it("reports managed skill documents staged in inbox as drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await mkdir(join(vaultDir, "inbox"), { recursive: true });
    await writeVaultLintFixture(vaultDir);

    await writeFile(
      join(vaultDir, "inbox", "kuma-vault.md"),
      `---
title: kuma:vault
domain: inbox
tags: []
created: 2026-04-16
updated: 2026-04-16
sources: []
source: skills/kuma-vault
---

managed skill mirror
`,
      "utf8",
    );

    const result = lintVaultFiles({
      vaultDir,
      mode: "full",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.file === "inbox/kuma-vault.md" && issue.code === "managed-skill-inbox")).toBe(true);
  });

  it("reports schema/runtime special-file set mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await writeVaultLintFixture(vaultDir);

    await writeFile(
      join(vaultDir, "schema.md"),
      `---
title: Kuma Wiki Schema
description: Wiki 페이지 작성 규칙과 운영 원칙
---

# Kuma Wiki Schema

## Special Files

### 1) \`dispatch-log.md\`

- **Primary writer:** \`kuma-task lifecycle hook\`
- **Frontmatter type 표준:** \`type: special/dispatch-log\`

### 2) \`legacy-skill-sync.md\`

- **Primary writer:** \`legacy skill sync\`
- **Frontmatter type 표준:** \`type: special/legacy\`
`,
      "utf8",
    );

    const result = lintVaultFiles({ vaultDir, mode: "full" });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.file === "schema.md" && issue.code === "schema-runtime-special-file-mismatch")).toBe(true);
  });

  it("fails full lint when a required section is missing and a link is broken", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await writeVaultLintFixture(vaultDir);

    await writeFile(
      join(vaultDir, "decisions.md"),
      `---
title: Decisions
type: special/decisions
updated: 2026-04-09T09:00:23Z
entry_rule: explicit-user-decision-only
source_of_truth: user-direct
boot_priority: 3
---

## About

- [Missing Page](missing-page.md) 확인 필요
`,
      "utf8",
    );

    const result = lintVaultFiles({ vaultDir, mode: "full" });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.file === "decisions.md" && issue.code === "missing-section")).toBe(true);
    expect(result.issues.some((issue) => issue.file === "decisions.md" && issue.code === "broken-link")).toBe(true);
  });

  it("exposes the vault-lint CLI as JSON and returns exit 0 on success", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-lint-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    await writeVaultLintFixture(vaultDir);

    const { stdout } = await execFile("node", [CLI_PATH, "vault-lint", "--mode", "full", "--vault-dir", vaultDir, "--json"]);

    const payload = JSON.parse(stdout);
    expect(payload.ok).toBe(true);
    expect(payload.fileCount).toBe(2);
  });
});
