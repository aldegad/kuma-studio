import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendDecision,
  listDecisions,
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

- SSoT 원칙은 유지한다.
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

- decisions-capture 구현 분업: Claude=spec, 부리=코드.
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
        scope: "project:kuma-studio",
        writer: "user-direct",
        resolvedText: "이 방향으로 간다.",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    expect(result.skipped).toBeNull();
    expect(result.entry).toMatchObject({
      scope: "project:kuma-studio",
      resolved_text: "이 방향으로 간다.",
      writer: "user-direct",
    });

    const savedProject = await readFile(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), "utf8");
    expect(savedProject).toContain("- 이 방향으로 간다.");

    const savedGlobal = await readFile(join(vaultDir, "decisions.md"), "utf8").catch(() => "");
    expect(savedGlobal).not.toContain("- 이 방향으로 간다.");
  });

  it("aggregates global and project decisions when listing", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir);
    await seedProjectFixture(vaultDir);

    const decisions = await listDecisions({ vaultDir });

    expect(decisions).toHaveLength(2);
    expect(decisions.map((entry) => entry.scope).sort()).toEqual([
      "global",
      "project:kuma-studio",
    ]);
  });

  it("dedupes within the recent 10 entries of the same store", async () => {
    const vaultDir = await createVaultRoot();

    await appendDecision({
      vaultDir,
      entry: {
        scope: "project:kuma-studio",
        writer: "user-direct",
        resolvedText: "이 방향으로 간다.",
        createdAt: "2026-04-12T06:00:00.000Z",
      },
    });

    const duplicate = await appendDecision({
      vaultDir,
      entry: {
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

  it("treats repartition as a no-op once scope is owned by the file path", async () => {
    const vaultDir = await createVaultRoot();
    await seedGlobalFixture(vaultDir);

    const result = await repartitionDecisionStores({ vaultDir });

    expect(result).toEqual({
      movedProjectScopes: [],
      movedCount: 0,
    });
  });
});
