import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runVaultLifecycleHook, parseTaskFileMetadata } from "./vault-lifecycle-hook.mjs";
import { parseFrontmatterDocument } from "./vault-ingest.mjs";

async function writeVaultLifecycleStubFiles(vaultDir) {
  await writeFile(
    join(vaultDir, "current-focus.md"),
    `---
title: Current Focus
type: special/current-focus
updated: 2026-04-09T09:00:23Z
active_count: 0
source_of_truth: kuma-task-lifecycle
boot_priority: 1
---

## Summary
- active dispatches: 0
- resume rule: current-focus -> dispatch-log -> decisions -> thread-map 순으로 이어 읽기

## Active Dispatches
(없음)

## Blockers
(없음)

## Last Completed
(없음)
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
boot_priority: 2
---

## Entries
(비어 있음 — lifecycle hook 연결 전)
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "thread-map.md"),
    `---
title: Thread Map
type: special/thread-map
updated: 2026-04-09T09:00:23Z
entry_format: active-thread-ledger
source_of_truth: kuma-task-lifecycle
boot_priority: 4
---

## Active Threads
(없음)

## Ledger
(비어 있음 — lifecycle hook + discord bridge 연결 전)
`,
    "utf8",
  );

  await writeFile(
    join(vaultDir, "decisions.md"),
    `---
title: Decisions Ledger
type: special/decisions
updated: 2026-04-09T09:00:23Z
entry_rule: explicit-user-decision-only
source_of_truth: user-direct
boot_priority: 3
---

## Open Decisions
(없음)

## Ledger
(비어 있음 — 유저 명시 발화만 기록)
`,
    "utf8",
  );
}

async function createTaskFile(taskPath, overrides = {}) {
  const fm = {
    id: "tookdaki-20260409-180729",
    project: "kuma-studio",
    initiator: "surface:1",
    worker: "surface:18",
    qa: "worker-self-report",
    signal: "kuma-studio-trusted-done",
    result: "/tmp/kuma-results/trusted.result.md",
    thread_id: "discord:thread-123",
    session_id: "workspace:1/surface:1",
    channel_id: "discord:thread-123",
    ...overrides,
  };
  const frontmatter = Object.entries(fm)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  await writeFile(
    taskPath,
    `---\n${frontmatter}\n---\n# lifecycle-task\n\nImplement lifecycle hook\n`,
    "utf8",
  );
  return fm;
}

describe("runVaultLifecycleHook", { timeout: 20000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("parses task frontmatter fields into metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);
    const taskPath = join(root, "demo.task.md");
    await createTaskFile(taskPath, { id: "tookdaki-20260413-045000" });

    const metadata = parseTaskFileMetadata(taskPath);
    expect(metadata).toMatchObject({
      taskFile: taskPath,
      id: "tookdaki-20260413-045000",
      project: "kuma-studio",
      worker: "surface:18",
      thread_id: "discord:thread-123",
    });
    expect(metadata.summary).toContain("Implement lifecycle hook");
  });

  it("returns null metadata when task file is missing or lacks frontmatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);
    const missing = join(root, "missing.task.md");
    expect(parseTaskFileMetadata(missing)).toBeNull();

    const noFrontmatter = join(root, "plain.task.md");
    await writeFile(noFrontmatter, "# not a task file\n", "utf8");
    expect(parseTaskFileMetadata(noFrontmatter)).toBeNull();
  });

  it("records dispatched -> worker-done -> qa-passed transitions in vault special files", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    const taskPath = join(root, "trusted.task.md");
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);
    await createTaskFile(taskPath);

    await runVaultLifecycleHook({
      event: "dispatched",
      taskFile: taskPath,
      vaultDir,
      summary: "Implement lifecycle hook",
    });
    await runVaultLifecycleHook({ event: "worker-done", taskFile: taskPath, vaultDir });
    await runVaultLifecycleHook({ event: "qa-passed", taskFile: taskPath, vaultDir });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    const dispatchLog = await readFile(join(vaultDir, "dispatch-log.md"), "utf8");
    const threadMap = await readFile(join(vaultDir, "thread-map.md"), "utf8");

    expect(currentFocus).toContain("active_count: 0");
    expect(currentFocus).toContain("task_id: tookdaki-20260409-180729");
    expect(currentFocus).toContain("worker-self-report signal emitted");
    expect(dispatchLog).toContain("state=dispatched");
    expect(dispatchLog).toContain("state=worker-done");
    expect(dispatchLog).toContain("state=awaiting-qa");
    expect(dispatchLog).toContain("state=qa-passed");
    expect(dispatchLog).toContain("state=signal-emitted");
    expect(threadMap).toContain("thread_id: discord:thread-123");
    expect(threadMap).toContain("status: closed");

    expect(parseFrontmatterDocument(currentFocus).frontmatter.type).toBe("special/current-focus");
    expect(parseFrontmatterDocument(dispatchLog).frontmatter.type).toBe("special/dispatch-log");
    expect(parseFrontmatterDocument(threadMap).frontmatter.type).toBe("special/thread-map");
  });

  it("records qa-rejected state with blocker when given a QA reject reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    const taskPath = join(root, "reject.task.md");
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);
    await createTaskFile(taskPath, { qa: "surface:17", thread_id: "discord:thread-456", channel_id: "discord:thread-456" });

    await runVaultLifecycleHook({ event: "dispatched", taskFile: taskPath, vaultDir });
    await runVaultLifecycleHook({
      event: "qa-rejected",
      taskFile: taskPath,
      vaultDir,
      blocker: "missing regression",
    });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    const dispatchLog = await readFile(join(vaultDir, "dispatch-log.md"), "utf8");
    const threadMap = await readFile(join(vaultDir, "thread-map.md"), "utf8");

    expect(currentFocus).toContain("state: qa-rejected");
    expect(currentFocus).toContain("blocker: missing regression");
    expect(dispatchLog).toContain("state=qa-rejected");
    expect(threadMap).toContain("status: qa-rejected");
  });

  it("records failed state with blocker when the worker is declared down", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    const taskPath = join(root, "dead.task.md");
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);
    await createTaskFile(taskPath, { qa: "surface:17", thread_id: "discord:thread-789", channel_id: "discord:thread-789" });

    await runVaultLifecycleHook({ event: "dispatched", taskFile: taskPath, vaultDir });
    await runVaultLifecycleHook({
      event: "failed",
      taskFile: taskPath,
      vaultDir,
      blocker: "worker down",
    });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    const dispatchLog = await readFile(join(vaultDir, "dispatch-log.md"), "utf8");
    const threadMap = await readFile(join(vaultDir, "thread-map.md"), "utf8");

    expect(currentFocus).toContain("state: failed");
    expect(currentFocus).toContain("worker down");
    expect(dispatchLog).toContain("state=failed");
    expect(threadMap).toContain("status: failed");
  });

  it("returns fast-lint warnings when a managed vault file has an invalid field", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    const taskPath = join(root, "warn.task.md");
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);
    await createTaskFile(taskPath, { id: "tookdaki-20260409-190014", signal: "kuma-studio-warn-done", thread_id: "discord:thread-warn", channel_id: "discord:thread-warn" });

    // Corrupt decisions.md boot_priority so fast-lint produces a warning.
    await writeFile(
      join(vaultDir, "decisions.md"),
      `---
title: Decisions Ledger
type: special/decisions
updated: 2026-04-09T09:00:23Z
entry_rule: explicit-user-decision-only
source_of_truth: user-direct
boot_priority: not-a-number
---

## Open Decisions
(없음)

## Ledger
(비어 있음 — 유저 명시 발화만 기록)
`,
      "utf8",
    );

    const { warnings } = await runVaultLifecycleHook({
      event: "dispatched",
      taskFile: taskPath,
      vaultDir,
      summary: "Lint integration",
    });

    expect(warnings.some((warning) => warning.message.includes("fast lint failed for decisions.md"))).toBe(true);

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    expect(currentFocus).toContain("task_id: tookdaki-20260409-190014");
  });

  it("short-circuits when KUMA_DISABLE_VAULT_HOOK=1 is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    const taskPath = join(root, "disabled.task.md");
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);
    await createTaskFile(taskPath, { id: "tookdaki-20260409-190014" });

    const previous = process.env.KUMA_DISABLE_VAULT_HOOK;
    process.env.KUMA_DISABLE_VAULT_HOOK = "1";
    try {
      const result = await runVaultLifecycleHook({
        event: "dispatched",
        taskFile: taskPath,
        vaultDir,
        summary: "Disabled integration",
      });
      expect(result).toEqual({ warnings: [] });
    } finally {
      if (previous === undefined) {
        delete process.env.KUMA_DISABLE_VAULT_HOOK;
      } else {
        process.env.KUMA_DISABLE_VAULT_HOOK = previous;
      }
    }

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    expect(currentFocus).toContain("active_count: 0");
    expect(currentFocus).not.toContain("tookdaki-20260409-190014");
  });

  it("ignores unknown events without writing vault files", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-vault-hook-"));
    tempRoots.push(root);

    const vaultDir = join(root, "vault");
    const taskPath = join(root, "unknown.task.md");
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);
    await createTaskFile(taskPath);

    const result = await runVaultLifecycleHook({
      event: "not-a-real-event",
      taskFile: taskPath,
      vaultDir,
    });

    expect(result).toEqual({ warnings: [] });
    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    expect(currentFocus).toContain("active_count: 0");
    expect(currentFocus).not.toContain("tookdaki-20260409-180729");
  });
});
