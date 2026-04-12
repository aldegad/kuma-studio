import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, assert, describe, it } from "vitest";

import { invalidatePlansCache, readPlans, watchPlans } from "./plan-store.mjs";

const tempDirs = [];
const originalCwd = process.cwd();

afterEach(async () => {
  delete process.env.KUMA_PLANS_DIR;
  delete process.env.KUMA_STUDIO_WORKSPACE;
  invalidatePlansCache();
  process.chdir(originalCwd);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function waitFor(assertion, timeoutMs = 4_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return;
    }
    await delay(50);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe("plan-store", () => {
  it("normalizes plan statuses and reads plans from the bound workspace root", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "kuma-plan-store-"));
    tempDirs.push(workspaceRoot);
    process.env.KUMA_STUDIO_WORKSPACE = workspaceRoot;

    const plansDir = join(workspaceRoot, ".kuma", "plans");
    await mkdir(plansDir, { recursive: true });

    await writeFile(join(plansDir, "index.md"), "# Root Index\n", "utf8");
    await mkdir(join(plansDir, "kuma-studio", "blocked-plan"), { recursive: true });
    await writeFile(
      join(plansDir, "kuma-studio", "active-plan.md"),
      `---
title: Active Plan
status: in_progress
created: 2026-04-08
---

## Todo
- [ ] keep going
`,
      "utf8",
    );
    await writeFile(
      join(plansDir, "kuma-studio", "blocked-plan", "index.md"),
      `---
title: Blocked Plan
status: blocked
---

## Waiting
- [ ] user confirmation
`,
      "utf8",
    );
    await writeFile(
      join(plansDir, "kuma-studio", "hold-plan.md"),
      `---
title: Hold Plan
status: hold
---

## Hold
- [ ] waiting
`,
      "utf8",
    );

    const snapshot = await readPlans();

    assert.strictEqual(snapshot.plans.some((plan) => plan.id === "index"), false);
    assert.deepStrictEqual(snapshot.source, {
      mode: "workspace-root",
      status: "ready",
      configured: true,
      workspaceRoot,
      plansDir,
      exists: true,
      message: null,
    });

    const activePlan = snapshot.plans.find((plan) => plan.id === "kuma-studio/active-plan");
    assert.deepStrictEqual(
      { status: activePlan?.status, statusColor: activePlan?.statusColor, project: activePlan?.project },
      { status: "active", statusColor: "blue", project: "kuma-studio" },
    );

    const blockedPlan = snapshot.plans.find((plan) => plan.id === "kuma-studio/blocked-plan");
    assert.deepStrictEqual(
      { status: blockedPlan?.status, statusColor: blockedPlan?.statusColor, project: blockedPlan?.project },
      { status: "blocked", statusColor: "orange", project: "kuma-studio" },
    );

    const holdPlan = snapshot.plans.find((plan) => plan.id === "kuma-studio/hold-plan");
    assert.deepStrictEqual(
      { status: holdPlan?.status, statusColor: holdPlan?.statusColor },
      { status: "hold", statusColor: "yellow" },
    );
  });

  it("refreshes the cached snapshot on markdown changes with debounce", async () => {
    const plansDir = await mkdtemp(join(tmpdir(), "kuma-plan-watch-"));
    tempDirs.push(plansDir);
    process.env.KUMA_PLANS_DIR = plansDir;

    await mkdir(join(plansDir, "kuma-studio"), { recursive: true });
    const planFile = join(plansDir, "kuma-studio", "studio-v2.md");
    await writeFile(
      planFile,
      `---
title: Studio V2
status: active
---

## Realtime
- [ ] plans websocket
`,
      "utf8",
    );

    const initialSnapshot = await readPlans();
    assert.strictEqual(initialSnapshot.checkedItems, 0);

    let changeCount = 0;
    let latestSnapshot = null;
    const stopWatching = watchPlans({
      debounceMs: 500,
      onChange(snapshot) {
        changeCount += 1;
        latestSnapshot = snapshot;
      },
    });

    try {
      await delay(50);
      await writeFile(
        planFile,
        `---
title: Studio V2
status: active
---

## Realtime
- [x] plans websocket
`,
        "utf8",
      );
      await delay(100);
      await writeFile(
        planFile,
        `---
title: Studio V2
status: active
---

## Realtime
- [x] plans websocket
- [ ] fallback polling
`,
        "utf8",
      );

      await waitFor(() => changeCount === 1);
      await delay(700);

      assert.strictEqual(changeCount, 1);
      assert.strictEqual(latestSnapshot?.checkedItems, 1);
      assert.strictEqual(latestSnapshot?.totalItems, 2);

      const refreshedSnapshot = await readPlans();
      assert.strictEqual(refreshedSnapshot.checkedItems, 1);
      assert.strictEqual(refreshedSnapshot.totalItems, 2);
    } finally {
      stopWatching();
    }
  });

  it("does not fall back to the current working directory when no workspace is bound", async () => {
    const fakeCwd = await mkdtemp(join(tmpdir(), "kuma-plan-cwd-"));
    tempDirs.push(fakeCwd);
    process.chdir(fakeCwd);

    const plansDir = join(fakeCwd, ".kuma", "plans", "kuma-studio");
    await mkdir(plansDir, { recursive: true });
    await writeFile(
      join(plansDir, "repo-cwd-plan.md"),
      `---
title: Repo Cwd Plan
status: active
---

## Hidden
- [ ] should not load from cwd
`,
      "utf8",
    );

    const snapshot = await readPlans();

    assert.deepStrictEqual(snapshot, {
      plans: [],
      totalItems: 0,
      checkedItems: 0,
      overallCompletionRate: 0,
      source: {
        mode: "unconfigured",
        status: "misconfigured",
        configured: false,
        workspaceRoot: null,
        plansDir: null,
        exists: false,
        message: "KUMA_STUDIO_WORKSPACE or KUMA_PLANS_DIR is required to resolve plans.",
      },
    });
  });
});
