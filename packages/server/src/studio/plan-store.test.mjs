import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, assert, describe, it } from "vitest";

import { invalidatePlansCache, readPlans, watchPlans } from "./plan-store.mjs";

const tempDirs = [];
const originalCwd = process.cwd();

const originalHome = process.env.HOME;

afterEach(async () => {
  delete process.env.KUMA_PLANS_DIR;
  delete process.env.KUMA_STUDIO_WORKSPACE;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
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
  it("normalizes plan statuses and reads plans from the configured plans directory", async () => {
    const plansDir = await mkdtemp(join(tmpdir(), "kuma-plan-store-"));
    tempDirs.push(plansDir);
    process.env.KUMA_PLANS_DIR = plansDir;

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
    await writeFile(
      join(plansDir, "kuma-studio", "cancelled-plan.md"),
      `---
title: Cancelled Plan
status: cancelled
---

## Cancelled
- [ ] do not ship this
`,
      "utf8",
    );

    const snapshot = await readPlans();

    assert.strictEqual(snapshot.plans.some((plan) => plan.id === "index"), false);
    assert.deepStrictEqual(snapshot.source, {
      mode: "explicit-plans-dir",
      status: "ready",
      configured: true,
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

    const cancelledPlan = snapshot.plans.find((plan) => plan.id === "kuma-studio/cancelled-plan");
    assert.deepStrictEqual(
      {
        status: cancelledPlan?.status,
        statusColor: cancelledPlan?.statusColor,
        checkedItems: cancelledPlan?.checkedItems,
        totalItems: cancelledPlan?.totalItems,
        completionRate: cancelledPlan?.completionRate,
      },
      {
        status: "cancelled",
        statusColor: "green",
        checkedItems: 1,
        totalItems: 1,
        completionRate: 100,
      },
    );

    assert.strictEqual(snapshot.totalItems, 4);
    assert.strictEqual(snapshot.checkedItems, 1);
    assert.strictEqual(snapshot.overallCompletionRate, 25);
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

  it("uses the canonical ~/.kuma/plans directory when no override is set", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "kuma-plan-home-"));
    tempDirs.push(fakeHome);
    process.env.HOME = fakeHome;

    const canonicalPlansDir = join(fakeHome, ".kuma", "plans");
    await mkdir(join(canonicalPlansDir, "kuma-studio"), { recursive: true });
    await writeFile(
      join(canonicalPlansDir, "kuma-studio", "canonical-plan.md"),
      `---
title: Canonical Plan
status: active
---

## Section
- [ ] item
`,
      "utf8",
    );

    const snapshot = await readPlans();

    assert.deepStrictEqual(snapshot.source, {
      mode: "canonical",
      status: "ready",
      configured: true,
      plansDir: canonicalPlansDir,
      exists: true,
      message: null,
    });
    assert.strictEqual(snapshot.plans.length, 1);
    assert.strictEqual(snapshot.plans[0]?.id, "kuma-studio/canonical-plan");
  });

  it("reports missing_dir against the canonical path when ~/.kuma/plans does not exist", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "kuma-plan-empty-home-"));
    tempDirs.push(fakeHome);
    process.env.HOME = fakeHome;

    const snapshot = await readPlans();

    assert.strictEqual(snapshot.source.mode, "canonical");
    assert.strictEqual(snapshot.source.status, "missing_dir");
    assert.strictEqual(snapshot.source.plansDir, join(fakeHome, ".kuma", "plans"));
    assert.strictEqual(snapshot.plans.length, 0);
  });

  it("preserves frontmatter warning semantics while using the shared parser", async () => {
    const plansDir = await mkdtemp(join(tmpdir(), "kuma-plan-warnings-"));
    tempDirs.push(plansDir);
    process.env.KUMA_PLANS_DIR = plansDir;

    await mkdir(join(plansDir, "kuma-studio"), { recursive: true });
    await writeFile(
      join(plansDir, "kuma-studio", "malformed-plan.md"),
      `---
title: Malformed Plan
bad frontmatter line
status: active
---

## Todo
- [x] keep warning shape
`,
      "utf8",
    );
    await writeFile(
      join(plansDir, "kuma-studio", "open-frontmatter.md"),
      `---
title: Missing Closing Delimiter
status: active

## Todo
- [ ] still readable
`,
      "utf8",
    );
    await writeFile(join(plansDir, "kuma-studio", "empty.md"), "", "utf8");

    const snapshot = await readPlans();

    const malformedPlan = snapshot.plans.find((plan) => plan.id === "kuma-studio/malformed-plan");
    assert.deepStrictEqual(malformedPlan?.warnings, [
      {
        code: "frontmatter-malformed",
        message: "Ignoring malformed frontmatter at line 3.",
      },
    ]);
    assert.strictEqual(malformedPlan?.title, "Malformed Plan");
    assert.strictEqual(malformedPlan?.checkedItems, 1);

    const openFrontmatterPlan = snapshot.plans.find((plan) => plan.id === "kuma-studio/open-frontmatter");
    assert.deepStrictEqual(openFrontmatterPlan?.warnings, [
      {
        code: "frontmatter-not-closed",
        message: "Frontmatter start delimiter was found without a closing delimiter.",
      },
    ]);
    assert.strictEqual(openFrontmatterPlan?.title, "kuma-studio/open-frontmatter");
    assert.strictEqual(openFrontmatterPlan?.checkedItems, 0);

    const emptyPlan = snapshot.plans.find((plan) => plan.id === "kuma-studio/empty");
    assert.deepStrictEqual(emptyPlan?.warnings, [
      {
        code: "empty-file",
        message: "Plan file is empty.",
      },
    ]);
    assert.strictEqual(emptyPlan?.title, "kuma-studio/empty");
  });
});
