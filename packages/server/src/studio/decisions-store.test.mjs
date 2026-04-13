import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendDecision,
  listOpenDecisions,
  loadDecisionBootPack,
  promoteToLedger,
  repartitionDecisionStores,
  resolveDecision,
} from "./decisions-store.mjs";

const GLOBAL_FIXTURE = `---
title: Decisions Ledger
type: special/decisions
updated: 2026-04-12T07:05:00+09:00
layers: inbox,ledger
boot_priority: 3
---

## About

fixture

## Open Decisions

- 20260412-070500-2stage: approve · global · "decisions.md 2-layer 모델 (Inbox + Ledger) 채택"

## Ledger

### 2026-04-12 07:05 KST · approve · global

- id: 20260412-070500-2stage
- action: approve
- scope: global
- writer: user-direct
- resolved_text: "decisions.md 를 2-layer (Inbox + Ledger) 로 재편한다."
- promoted_from: 20260412-062000-e0127e
- context_ref: ~/.kuma/plans/kuma-studio/decisions-capture.md

## Inbox

verbatim raw capture. 아직 결정된 것이 아니며, Ledger 로 승격되기 전까지는 맥락/트리거 기록용.

### 20260412-070100-globalraw · user-direct

- action: preference
- scope: global
- original_text: "앞으로 branch/worktree 는 승인 후에만 만든다."
- status: unresolved
`;

const PROJECT_FIXTURE = `---
title: kuma-studio Project Decisions Ledger
type: special/project-decisions
project: kuma-studio
updated: 2026-04-12T07:05:00+09:00
layers: inbox,ledger
boot_priority: 3
---

## About

fixture

## Open Decisions

- 20260412-070500-capturesplit: approve · project:kuma-studio · "decisions-capture 구현 분업"

## Ledger

### 2026-04-12 07:05 KST · approve · project:kuma-studio

- id: 20260412-070500-capturesplit
- action: approve
- scope: project:kuma-studio
- writer: user-direct
- resolved_text: "decisions-capture 구현 분업: Claude=spec/철학, 부리(Codex)=코드 구현."

## Inbox

verbatim raw capture. 아직 결정된 것이 아니며, Ledger 로 승격되기 전까지는 맥락/트리거 기록용.

### 20260412-064100-5bca9d · user-direct

- action: approve
- scope: project:kuma-studio
- original_text: "좋아 둘다하자. 부리 작업 오래걸리니까."
- context_ref: decisions-capture + subagent-hook-policy 병렬 진행 트리거.
- status: unresolved
`;

const MIXED_GLOBAL_FIXTURE = `---
title: Decisions Ledger
type: special/decisions
updated: 2026-04-13T12:00:00+09:00
layers: inbox,ledger
boot_priority: 3
---

## About

fixture

## Open Decisions

- 20260413-110000-global: preference · global · "앞으로 branch/worktree 는 승인 후에만 만든다"
- 20260413-111500-project: rule · project:kuma-studio · "bootstrap은 surface registry를 유지해야 한다"

## Ledger

### 2026-04-13 11:00 KST · preference · global

- id: 20260413-110000-global
- action: preference
- scope: global
- writer: user-direct
- resolved_text: "앞으로 branch/worktree 는 승인 후에만 만든다."

### 2026-04-13 11:15 KST · preference · project:kuma-studio

- id: 20260413-111500-project
- action: preference
- scope: project:kuma-studio
- writer: user-direct
- resolved_text: "bootstrap은 surface registry를 유지해야 한다."

## Inbox

verbatim raw capture. 아직 결정된 것이 아니며, Ledger 로 승격되기 전까지는 맥락/트리거 기록용.

### 20260413-112000-projectraw · kuma-detect

- action: priority
- scope: project:kuma-studio
- original_text: "이거 먼저 처리"
- status: unresolved
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

  it("scaffolds a global decisions file with About, Open, Ledger, and Inbox sections", async () => {
    const vaultDir = await createVaultRoot();

    const open = await listOpenDecisions({ vaultDir });

    expect(open).toEqual({ ledger: [], inbox: [] });
    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain("## About");
    expect(saved).toContain("## Open Decisions");
    expect(saved).toContain("## Ledger");
    expect(saved).toContain("## Inbox");
    expect(saved).toContain("global/system decision memory");
  });

  it("routes project inbox entries into the per-project decisions file", async () => {
    const vaultDir = await createVaultRoot();

    const result = await appendDecision({
      vaultDir,
      entry: {
        layer: "inbox",
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        originalText: "이걸로 가자",
        contextRef: "task:demo",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    expect(result.skipped).toBeNull();
    expect(result.entry).toMatchObject({
      layer: "inbox",
      action: "approve",
      scope: "project:kuma-studio",
      original_text: "이걸로 가자",
      status: "unresolved",
    });

    const savedProject = await readFile(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), "utf8");
    expect(savedProject).toContain('original_text: "이걸로 가자"');
    expect(savedProject).toContain("- status: unresolved");

    const savedGlobal = await readFile(join(vaultDir, "decisions.md"), "utf8").catch(() => "");
    expect(savedGlobal).not.toContain('original_text: "이걸로 가자"');
  });

  it("aggregates global and project decisions when listing open decisions", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir);
    await seedProjectFixture(vaultDir);

    const open = await listOpenDecisions({ vaultDir });

    expect(open.ledger).toHaveLength(2);
    expect(open.inbox).toHaveLength(2);
    expect(open.ledger.map((entry) => entry.scope)).toEqual([
      "project:kuma-studio",
      "global",
    ]);
  });

  it("appends global ledger entries to the global decisions file", async () => {
    const vaultDir = await createVaultRoot();

    const result = await appendDecision({
      vaultDir,
      entry: {
        layer: "ledger",
        action: "priority",
        scope: "global",
        writer: "user-direct",
        resolvedText: "우선순위는 dashboard empty state 수정이 먼저다.",
        contextRef: "task:priority",
        createdAt: "2026-04-12T07:00:00.000Z",
      },
    });

    expect(result.skipped).toBeNull();
    expect(result.entry).toMatchObject({
      layer: "ledger",
      action: "priority",
      scope: "global",
      resolved_text: "우선순위는 dashboard empty state 수정이 먼저다.",
    });

    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain('resolved_text: "우선순위는 dashboard empty state 수정이 먼저다."');
  });

  it("promotes a project inbox entry into the matching project ledger", async () => {
    const vaultDir = await createVaultRoot();
    await seedProjectFixture(vaultDir);

    const promoted = await promoteToLedger({
      vaultDir,
      inboxId: "20260412-064100-5bca9d",
      resolvedText: "병렬 진행을 그대로 유지한다.",
      writer: "user-direct",
      contextRef: "task:parallel:first",
    });

    expect(promoted.inboxId).toBe("20260412-064100-5bca9d");
    expect(promoted.ledgerId).toBeTruthy();

    const saved = await readFile(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), "utf8");
    expect(saved).toContain(`- promoted_from: 20260412-064100-5bca9d`);
    expect(saved).toContain(`- promoted_to: ${promoted.ledgerId}`);
    expect(saved).toContain("- status: promoted");
  });

  it("allows repeated promotion of the same project inbox entry and preserves comma-separated promoted_to", async () => {
    const vaultDir = await createVaultRoot();
    await seedProjectFixture(vaultDir);

    const firstPromotion = await promoteToLedger({
      vaultDir,
      inboxId: "20260412-064100-5bca9d",
      resolvedText: "병렬 진행을 그대로 유지한다.",
      writer: "user-direct",
      contextRef: "task:parallel:first",
    });

    const secondPromotion = await promoteToLedger({
      vaultDir,
      inboxId: "20260412-064100-5bca9d",
      resolvedText: "병렬 진행하되 decisions-store Phase 5를 우선 마무리한다.",
      writer: "user-direct",
      contextRef: "task:parallel:second",
    });

    expect(firstPromotion.ledgerId).not.toBe(secondPromotion.ledgerId);
    const saved = await readFile(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), "utf8");
    expect(saved).toContain(`- promoted_to: ${firstPromotion.ledgerId}, ${secondPromotion.ledgerId}`);
  });

  it("keeps inbox dedupe within the recent 10 entries of the same project store", async () => {
    const vaultDir = await createVaultRoot();

    await appendDecision({
      vaultDir,
      entry: {
        layer: "inbox",
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        originalText: "이 방향으로 간다",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    const duplicate = await appendDecision({
      vaultDir,
      entry: {
        layer: "inbox",
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        originalText: "이 방향으로 간다",
        createdAt: "2026-04-12T06:01:00.000Z",
      },
    });

    expect(duplicate.skipped).toBe("duplicate");
    const open = await listOpenDecisions({ vaultDir });
    expect(open.inbox).toHaveLength(1);
  });

  it("keeps resolveDecision as a promotion alias across split stores", async () => {
    const vaultDir = await createVaultRoot();
    await seedProjectFixture(vaultDir);

    const resolved = await resolveDecision({
      vaultDir,
      id: "20260412-064100-5bca9d",
      resolvedText: "이 항목은 이번 배치에서 보류한다.",
      writer: "user-direct",
      contextRef: "task:alias",
    });

    expect(resolved).toMatchObject({
      inboxId: "20260412-064100-5bca9d",
      ledgerId: expect.any(String),
    });

    const open = await listOpenDecisions({ vaultDir });
    expect(open.inbox).toHaveLength(0);
    expect(open.ledger[0]).toMatchObject({
      promoted_from: "20260412-064100-5bca9d",
      resolved_text: "이 항목은 이번 배치에서 보류한다.",
    });
  });

  it("loads boot packs as separate global and project sections", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir);
    await seedProjectFixture(vaultDir);

    const pack = await loadDecisionBootPack({
      vaultDir,
      projectName: "kuma-studio",
      openLedgerLimit: 10,
      latestResolvedLimit: 10,
      unresolvedInboxLimit: 10,
    });

    expect(pack.global?.source).toContain("decisions.md");
    expect(pack.project?.source).toContain("kuma-studio.project-decisions.md");
    expect(pack.global?.latest_resolved[0]?.scope).toBe("global");
    expect(pack.project?.latest_resolved[0]?.scope).toBe("project:kuma-studio");
    expect(pack.project?.inbox_unresolved[0]?.original_text).toBe("좋아 둘다하자. 부리 작업 오래걸리니까.");
  });

  it("repartitions legacy mixed project entries into a project-decisions file", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir, MIXED_GLOBAL_FIXTURE);

    const result = await repartitionDecisionStores({ vaultDir });

    expect(result).toEqual({
      movedProjectScopes: ["project:kuma-studio"],
      movedLedgerCount: 1,
      movedInboxCount: 1,
    });

    const globalSaved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    const projectSaved = await readFile(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), "utf8");
    expect(globalSaved).toContain("20260413-110000-global");
    expect(globalSaved).not.toContain("20260413-111500-project");
    expect(projectSaved).toContain("20260413-111500-project");
    expect(projectSaved).toContain("20260413-112000-projectraw");
  });
});
