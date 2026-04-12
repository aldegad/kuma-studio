import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendDecision,
  listOpenDecisions,
  resolveDecision,
  supersedeDecision,
} from "./decisions-store.mjs";

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

  it("appends verbatim decisions and scaffolds the ledger file", async () => {
    const vaultDir = await createVaultRoot();

    const result = await appendDecision({
      vaultDir,
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
    expect(result.entry.action).toBe("approve");
    expect(result.entry.original_text).toBe("이걸로 가자");

    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain('original_text: "이걸로 가자"');
    expect(saved).toContain("- context_ref: task:demo");
    expect(saved).toContain("## Open Decisions");
  });

  it("dedupes the same original_text and action within the recent 10 decision entries", async () => {
    const vaultDir = await createVaultRoot();

    await appendDecision({
      vaultDir,
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        originalText: "이 방향으로 가",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    const duplicate = await appendDecision({
      vaultDir,
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        originalText: "이 방향으로 가",
        createdAt: "2026-04-12T06:01:00.000Z",
      },
    });

    expect(duplicate.skipped).toBe("duplicate");
    const open = await listOpenDecisions({ vaultDir });
    expect(open).toHaveLength(1);
  });

  it("allows the same decision again after it falls outside the recent-10 dedupe window", async () => {
    const vaultDir = await createVaultRoot();

    for (let index = 0; index < 11; index += 1) {
      await appendDecision({
        vaultDir,
        entry: {
          action: index === 0 ? "approve" : "preference",
          scope: "project:kuma-studio",
          writer: "kuma-detect",
          originalText: index === 0 ? "이걸로 고정" : `다음부터 규칙 ${index}`,
          createdAt: `2026-04-12T06:${String(index).padStart(2, "0")}:00.000Z`,
        },
      });
    }

    const appended = await appendDecision({
      vaultDir,
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        originalText: "이걸로 고정",
        createdAt: "2026-04-12T06:20:00.000Z",
      },
    });

    expect(appended.skipped).toBeNull();
    const open = await listOpenDecisions({ vaultDir });
    expect(open.filter((entry) => entry.original_text === "이걸로 고정")).toHaveLength(2);
  });

  it("resolves decisions with append-only resolution entries", async () => {
    const vaultDir = await createVaultRoot();
    const appended = await appendDecision({
      vaultDir,
      entry: {
        action: "hold",
        scope: "project:kuma-studio",
        writer: "user-direct",
        originalText: "이건 나중에",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    const resolved = await resolveDecision({
      vaultDir,
      id: appended.entry.id,
      writer: "user-direct",
      resolvedAt: "2026-04-12T07:00:00.000Z",
    });

    expect(resolved.entry.action).toBe("resolve");
    expect(resolved.entry.decision_id).toBe(appended.entry.id);

    const open = await listOpenDecisions({ vaultDir });
    expect(open).toHaveLength(0);

    const saved = await readFile(join(vaultDir, "decisions.md"), "utf8");
    expect(saved).toContain(`- decision_id: ${appended.entry.id}`);
    expect(saved).toContain("- resolved_at: 2026-04-12T07:00:00.000Z");
  });

  it("supersedes an open decision by appending a new linked entry", async () => {
    const vaultDir = await createVaultRoot();
    const oldDecision = await appendDecision({
      vaultDir,
      entry: {
        action: "priority",
        scope: "project:kuma-studio",
        writer: "user-direct",
        originalText: "이거 먼저",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    const replacement = await supersedeDecision({
      vaultDir,
      oldId: oldDecision.entry.id,
      newEntry: {
        action: "priority",
        scope: "project:kuma-studio",
        writer: "user-direct",
        originalText: "아니 이거보다 저거 먼저",
        createdAt: "2026-04-12T06:05:00.000Z",
      },
    });

    expect(replacement.skipped).toBeNull();
    expect(replacement.entry.supersedes).toBe(oldDecision.entry.id);

    const open = await listOpenDecisions({ vaultDir });
    expect(open).toHaveLength(1);
    expect(open[0]?.original_text).toBe("아니 이거보다 저거 먼저");
  });
});
