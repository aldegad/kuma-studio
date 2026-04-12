import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendDecision,
  listOpenDecisions,
  promoteToLedger,
  resolveDecision,
} from "./decisions-store.mjs";

const LIVE_SHAPE_FIXTURE = `---
title: Decisions Ledger
type: special/decisions
updated: 2026-04-12T07:05:00+09:00
layers: inbox,ledger
boot_priority: 3
---

## About

이 파일은 2-layer 로 동작한다.

- **Ledger (resolved)** — 유저가 확정한 결정의 기록. writer = \`user-direct\` 또는 Inbox 에서 \`user-confirmed promotion\` 을 거친 entry.
- **Inbox (raw triggers)** — 결정을 촉발한 원본 발화/계획 todo/감사 hit. writer = \`kuma-detect | lifecycle-emitter | noeuri-audit | user-direct (unresolved)\`. **verbatim-only** — AI 해석/요약 금지. 아직 결정된 것이 아님.

승격 절차: Inbox entry 를 검토 → 유저가 resolved 문장을 확정 → Ledger 에 새 entry append (\`promoted_from: <inbox-id>\` 필드). Inbox 는 삭제하지 않고 \`status: promoted\` 로 마킹.

Boot pack 로드는 \`Ledger open + latest resolved 10\` + \`Inbox unresolved\`.

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

### 20260412-062000-e0127e · user-direct

- action: approve
- scope: project:kuma-studio
- original_text: "그러게. 이거 설계를 다시해야하겠네."
- context_ref: decisions-capture.md 설계 트리거
- status: promoted
- promoted_to: 20260412-070500-2stage, 20260412-070500-second

### 20260412-064100-5bca9d · user-direct

- action: approve
- scope: project:kuma-studio
- original_text: "좋아 둘다하자. 부리 작업 오래걸리니까."
- context_ref: decisions-capture + subagent-hook-policy 병렬 진행 트리거.
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

  async function seedDecisionsFile(vaultDir, contents = LIVE_SHAPE_FIXTURE) {
    await writeFile(join(vaultDir, "decisions.md"), contents, "utf8");
  }

  it("scaffolds a 2-layer decisions file with About, Open, Ledger, and Inbox sections", async () => {
    const vaultDir = await createVaultRoot();

    const open = await listOpenDecisions({ vaultDir });

    expect(open).toEqual({ ledger: [], inbox: [] });
    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain("## About");
    expect(saved).toContain("## Open Decisions");
    expect(saved).toContain("## Ledger");
    expect(saved).toContain("## Inbox");
    expect(saved).toContain("verbatim raw capture.");
  });

  it("appends inbox entries and returns unresolved inbox decisions separately from ledger", async () => {
    const vaultDir = await createVaultRoot();

    const result = await appendDecision({
      vaultDir,
      layer: "inbox",
      entry: {
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
      original_text: "이걸로 가자",
      status: "unresolved",
    });

    const open = await listOpenDecisions({ vaultDir });
    expect(open.ledger).toHaveLength(0);
    expect(open.inbox).toHaveLength(1);
    expect(open.inbox[0]).toMatchObject({
      original_text: "이걸로 가자",
      context_ref: "task:demo",
    });

    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain('original_text: "이걸로 가자"');
    expect(saved).toContain("- status: unresolved");
  });

  it("appends ledger entries to the resolved layer and exposes them via ledger open decisions", async () => {
    const vaultDir = await createVaultRoot();

    const result = await appendDecision({
      vaultDir,
      layer: "ledger",
      entry: {
        action: "priority",
        scope: "project:kuma-studio",
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
      resolved_text: "우선순위는 dashboard empty state 수정이 먼저다.",
    });

    const open = await listOpenDecisions({ vaultDir });
    expect(open.ledger).toHaveLength(1);
    expect(open.inbox).toHaveLength(0);
    expect(open.ledger[0]).toMatchObject({
      resolved_text: "우선순위는 dashboard empty state 수정이 먼저다.",
      context_ref: "task:priority",
    });

    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain('resolved_text: "우선순위는 dashboard empty state 수정이 먼저다."');
    expect(saved).toContain('## Open Decisions\n\n- ');
  });

  it("promotes an inbox entry into ledger while preserving history and hiding promoted inbox items from unresolved results", async () => {
    const vaultDir = await createVaultRoot();

    const inbox = await appendDecision({
      vaultDir,
      layer: "inbox",
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "user-direct",
        originalText: "이 방향으로 다시 설계하자",
        contextRef: "task:phase5",
        createdAt: "2026-04-12T06:20:00.000Z",
      },
    });

    const promoted = await promoteToLedger({
      vaultDir,
      inboxId: inbox.entry.id,
      resolvedText: "decisions-store는 2-layer snapshot 모델을 기준으로 구현한다.",
      writer: "user-direct",
      contextRef: "task:phase5:promote",
    });

    expect(promoted.inboxId).toBe(inbox.entry.id);
    expect(promoted.ledgerId).toBeTruthy();

    const open = await listOpenDecisions({ vaultDir });
    expect(open.inbox).toHaveLength(0);
    expect(open.ledger).toHaveLength(1);
    expect(open.ledger[0]).toMatchObject({
      id: promoted.ledgerId,
      promoted_from: inbox.entry.id,
      resolved_text: "decisions-store는 2-layer snapshot 모델을 기준으로 구현한다.",
      context_ref: "task:phase5:promote",
    });

    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain(`- promoted_from: ${inbox.entry.id}`);
    expect(saved).toContain(`- promoted_to: ${promoted.ledgerId}`);
    expect(saved).toContain("- status: promoted");
  });

  it("allows repeated promotion of the same inbox entry and preserves the live comma-separated promoted_to style", async () => {
    const vaultDir = await createVaultRoot();
    await seedDecisionsFile(vaultDir);

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

    const open = await listOpenDecisions({ vaultDir });
    expect(open.inbox).toHaveLength(0);
    expect(open.ledger.map((entry) => entry.promoted_from)).toEqual([
      "20260412-062000-e0127e",
      "20260412-064100-5bca9d",
      "20260412-064100-5bca9d",
    ]);

    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain(
      `- promoted_to: ${firstPromotion.ledgerId}, ${secondPromotion.ledgerId}`,
    );
    expect(saved).toContain(
      "- promoted_to: 20260412-070500-2stage, 20260412-070500-second",
    );
    expect(saved).toContain(
      "verbatim raw capture. 아직 결정된 것이 아니며, Ledger 로 승격되기 전까지는 맥락/트리거 기록용.",
    );
  });

  it("keeps inbox dedupe within the recent 10 inbox entries only", async () => {
    const vaultDir = await createVaultRoot();

    await appendDecision({
      vaultDir,
      layer: "inbox",
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        originalText: "이 방향으로 간다",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    const duplicate = await appendDecision({
      vaultDir,
      layer: "inbox",
      entry: {
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

  it("keeps resolveDecision as a promotion alias for the existing runtime seam", async () => {
    const vaultDir = await createVaultRoot();

    const inbox = await appendDecision({
      vaultDir,
      layer: "inbox",
      entry: {
        action: "hold",
        scope: "project:kuma-studio",
        writer: "user-direct",
        originalText: "이건 조금 더 보자",
      },
    });

    const resolved = await resolveDecision({
      vaultDir,
      id: inbox.entry.id,
      resolvedText: "이 항목은 이번 배치에서 보류한다.",
      writer: "user-direct",
      contextRef: "task:alias",
    });

    expect(resolved).toMatchObject({
      inboxId: inbox.entry.id,
      ledgerId: expect.any(String),
    });

    const open = await listOpenDecisions({ vaultDir });
    expect(open.inbox).toEqual([]);
    expect(open.ledger[0]).toMatchObject({
      promoted_from: inbox.entry.id,
      resolved_text: "이 항목은 이번 배치에서 보류한다.",
    });
  });
});
