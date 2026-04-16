import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendDecision,
  listDecisions,
  loadDecisionBootPack,
  repartitionDecisionStores,
} from "./decisions-store.mjs";

const GLOBAL_FIXTURE = `---
title: Decisions
type: special/decisions
updated: 2026-04-12T07:05:00+09:00
boot_priority: 3
---

## About

fixture

## Decisions

### 2026-04-12 07:05 KST · approve · global

- id: 20260412-070500-global1
- action: approve
- scope: global
- writer: user-direct
- resolved_text: "SSoT 원칙은 유지한다."
`;

const PROJECT_FIXTURE = `---
title: kuma-studio Project Decisions
type: special/project-decisions
project: kuma-studio
updated: 2026-04-12T07:05:00+09:00
boot_priority: 3
---

## About

fixture

## Decisions

### 2026-04-12 07:05 KST · approve · project:kuma-studio

- id: 20260412-070500-project1
- action: approve
- scope: project:kuma-studio
- writer: user-direct
- resolved_text: "decisions-capture 구현 분업: Claude=spec, 부리=코드."
`;

const MIXED_GLOBAL_FIXTURE = `---
title: Decisions
type: special/decisions
updated: 2026-04-13T12:00:00+09:00
boot_priority: 3
---

## About

fixture

## Decisions

### 2026-04-13 11:00 KST · preference · global

- id: 20260413-110000-global
- action: preference
- scope: global
- writer: user-direct
- resolved_text: "branch/worktree 는 승인 후에만 만든다."

### 2026-04-13 11:15 KST · preference · project:kuma-studio

- id: 20260413-111500-project
- action: preference
- scope: project:kuma-studio
- writer: user-direct
- resolved_text: "bootstrap 은 surface registry 를 유지해야 한다."
`;

describe("decisions-store", () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createVaultRoot() {
    const root = await mkdtemp(join(tmpdir(), "kuma-decisions-store-"));
    tempRoots.push(root);
    return root;
  }

  async function seedGlobalFixture(vaultDir, contents = GLOBAL_FIXTURE) {
    await writeFile(join(vaultDir, "decisions.md"), contents, "utf8");
  }

  async function seedProjectFixture(vaultDir, projectName = "kuma-studio", contents = PROJECT_FIXTURE) {
    await mkdir(join(vaultDir, "projects"), { recursive: true });
    await writeFile(join(vaultDir, "projects", `${projectName}.project-decisions.md`), contents, "utf8");
  }

  it("scaffolds a decisions file with only About and Decisions sections", async () => {
    const vaultDir = await createVaultRoot();

    const decisions = await listDecisions({ vaultDir });

    expect(decisions).toEqual([]);
    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain("## About");
    expect(saved).toContain("## Decisions");
    expect(saved).not.toContain("## Open Decisions");
    expect(saved).not.toContain("## Ledger");
    expect(saved).not.toContain("## Inbox");
    expect(saved).not.toContain("layers:");
  });

  it("rejects non user-direct writers", async () => {
    const vaultDir = await createVaultRoot();

    await expect(
      appendDecision({
        vaultDir,
        entry: {
          action: "approve",
          scope: "global",
          writer: "kuma-detect",
          resolvedText: "auto-detect 는 허용되지 않는다.",
          createdAt: "2026-04-12T07:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/writer must be user-direct/u);
  });

  it("routes project-scoped decisions into the per-project file", async () => {
    const vaultDir = await createVaultRoot();

    const result = await appendDecision({
      vaultDir,
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "user-direct",
        resolvedText: "이 방향으로 간다.",
        contextRef: "task:demo",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    expect(result.skipped).toBeNull();
    expect(result.entry).toMatchObject({
      action: "approve",
      scope: "project:kuma-studio",
      resolved_text: "이 방향으로 간다.",
      writer: "user-direct",
    });

    const savedProject = await readFile(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), "utf8");
    expect(savedProject).toContain('resolved_text: "이 방향으로 간다."');

    const savedGlobal = await readFile(join(vaultDir, "decisions.md"), "utf8").catch(() => "");
    expect(savedGlobal).not.toContain('resolved_text: "이 방향으로 간다."');
  });

  it("aggregates global and project decisions when listing", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir);
    await seedProjectFixture(vaultDir);

    const decisions = await listDecisions({ vaultDir });

    expect(decisions).toHaveLength(2);
    expect(decisions.map((entry) => entry.scope)).toEqual([
      "project:kuma-studio",
      "global",
    ]);
  });

  it("dedupes within the recent 10 entries of the same store", async () => {
    const vaultDir = await createVaultRoot();

    await appendDecision({
      vaultDir,
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "user-direct",
        resolvedText: "이 방향으로 간다.",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    const duplicate = await appendDecision({
      vaultDir,
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "user-direct",
        resolvedText: "이 방향으로 간다.",
        createdAt: "2026-04-12T06:01:00.000Z",
      },
    });

    expect(duplicate.skipped).toBe("duplicate");
    const decisions = await listDecisions({ vaultDir });
    expect(decisions).toHaveLength(1);
  });

  it("loads boot packs as separate global and project sections", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir);
    await seedProjectFixture(vaultDir);

    const pack = await loadDecisionBootPack({
      vaultDir,
      projectName: "kuma-studio",
      limit: 10,
    });

    expect(pack.global?.source).toContain("decisions.md");
    expect(pack.project?.source).toContain("kuma-studio.project-decisions.md");
    expect(pack.global?.decisions[0]?.scope).toBe("global");
    expect(pack.project?.decisions[0]?.scope).toBe("project:kuma-studio");
  });

  it("repartitions legacy mixed project entries into a project-decisions file", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir, MIXED_GLOBAL_FIXTURE);

    const result = await repartitionDecisionStores({ vaultDir });

    expect(result).toEqual({
      movedProjectScopes: ["project:kuma-studio"],
      movedCount: 1,
    });

    const globalSaved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    const projectSaved = await readFile(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), "utf8");
    expect(globalSaved).toContain("20260413-110000-global");
    expect(globalSaved).not.toContain("20260413-111500-project");
    expect(projectSaved).toContain("20260413-111500-project");
  });
});
