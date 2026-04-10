import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

const WAIT_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-wait.sh");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

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

function parseFrontmatter(contents) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n/m);
  if (!match) {
    throw new Error("missing frontmatter");
  }

  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

describe("cmux wait script", { timeout: 30000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("returns exit 0 and prints the result when auto ingest fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const taskDir = join(root, "tasks");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const surfacesPath = join(root, "surfaces.json");
    const sendLog = join(root, "send.log");
    const resultPath = join(resultDir, "phase8.result.md");
    const signalName = "kuma-studio-tookdaki-20260408-185642-done";
    const planPath = "~/.kuma/plans/kuma-studio/noeuri-vault-consolidation.md";

    await mkdir(binDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });

    await writeFile(
      resultPath,
      `# phase8\n\n- result body\n`,
      "utf8",
    );
    await writeFile(
      join(taskDir, "phase8.task.md"),
      `---
id: tookdaki-20260408-185642
project: kuma-studio
worker: surface:37
qa: surface:39
signal: ${signalName}
result: ${resultPath}
plan: ${planPath}
---
`,
      "utf8",
    );
    await writeFile(join(signalDir, signalName), "done\n", "utf8");
    await writeFile(
      surfacesPath,
      `${JSON.stringify({
        system: {
          "🦌 노을이": "surface:46",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    await writeExecutable(
      join(binDir, "npm"),
      `#!/bin/bash
echo "ingest boom" >&2
exit 1
`,
    );

    const sendScriptPath = join(root, "kuma-cmux-send.sh");
    await writeExecutable(
      sendScriptPath,
      `#!/bin/bash
set -euo pipefail
printf '%q ' "$@" > "${sendLog}"
printf '\\n' >> "${sendLog}"
`,
    );

    const { stdout, stderr } = await execFile("bash", [WAIT_SCRIPT_PATH, signalName, resultPath], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_TASK_DIR: taskDir,
        KUMA_SURFACES_PATH: surfacesPath,
        KUMA_CMUX_SEND_SCRIPT: sendScriptPath,
        KUMA_REPO_ROOT: root,
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_USER_MEMO_DIR: join(root, "user-memo"),
      },
    });

    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
    expect(stdout).toContain(`RESULT_FILE: ${resultPath}`);
    expect(stdout).toContain("- result body");
    expect(stderr).toContain("AUTO_INGEST_FAILED: ingest boom");
    expect(stderr).not.toContain("NOEURI_TRIGGER:");
    await expect(readFile(sendLog, "utf8")).rejects.toThrow();
  });

  it("waits for the exact fresh signal file and ignores stale or similar matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const taskDir = join(root, "tasks");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const resultPath = join(resultDir, "fresh.result.md");
    const taskPath = join(taskDir, "fresh.task.md");
    const signalName = "kuma-studio-howl-20260410-164947-done";
    const similarSignalName = "kuma-studio-howl-20260410-164423-done";

    await mkdir(binDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
if [ "$1" = "wait-for" ]; then
  echo "false positive native wait" >&2
  exit 0
fi
exit 0
`,
    );

    await writeFile(join(signalDir, similarSignalName), "done\n", "utf8");
    await writeFile(join(signalDir, signalName), "stale\n", "utf8");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));

    await writeFile(
      taskPath,
      `---
id: howl-20260410-164947
project: kuma-studio
worker: surface:3
qa: worker-self-report
signal: ${signalName}
result: ${resultPath}
---
# fresh-task

Wait for an exact signal file
`,
      "utf8",
    );

    const child = spawn("bash", [WAIT_SCRIPT_PATH, signalName, resultPath, "--timeout", "4"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_AUTO_VAULT_INGEST: "0",
        KUMA_AUTO_NOEURI_TRIGGER: "0",
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_TASK_DIR: taskDir,
        KUMA_WAIT_POLL_INTERVAL: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));

    expect(child.exitCode).toBeNull();
    expect(stdout).not.toContain("SIGNAL_RECEIVED");
    expect(stderr).not.toContain("false positive native wait");

    await writeFile(resultPath, "# fresh result\nexact match only\n", "utf8");
    await writeFile(join(signalDir, signalName), "done\n", "utf8");

    const exitCode = await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", resolvePromise);
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
    expect(stdout).toContain("exact match only");
    expect(stderr).toBe("");
  });

  it("dispatches a Noeuri follow-up and still exits 0 after successful auto ingest", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const taskDir = join(root, "tasks");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const surfacesPath = join(root, "surfaces.json");
    const sendLog = join(root, "send.log");
    const resultPath = join(resultDir, "phase4.result.md");
    const signalName = "kuma-studio-kuma-task-allowlist-noeuri-phase4-done";
    const planPath = "~/.kuma/plans/kuma-studio/kuma-cli-unification.md";

    await mkdir(binDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });

    await writeFile(
      resultPath,
      `# phase4\n\n- result body\n`,
      "utf8",
    );
    await writeFile(
      join(taskDir, "phase4.task.md"),
      `---
id: kuma-task-allowlist-noeuri-phase4
project: kuma-studio
worker: surface:37
qa: surface:39
signal: ${signalName}
result: ${resultPath}
plan: ${planPath}
---
`,
      "utf8",
    );
    await writeFile(join(signalDir, signalName), "done\n", "utf8");
    await writeFile(
      surfacesPath,
      `${JSON.stringify({
        system: {
          "🦌 노을이": "surface:46",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    await writeExecutable(
      join(binDir, "npm"),
      `#!/bin/bash
set -euo pipefail
cat <<'JSON'
{
  "status": "ingested",
  "taskId": "kuma-task-allowlist-noeuri-phase4",
  "ingest": {
    "relativePagePath": "projects/kuma-studio.md"
  }
}
JSON
`,
    );

    const sendScriptPath = join(root, "kuma-cmux-send.sh");
    await writeExecutable(
      sendScriptPath,
      `#!/bin/bash
set -euo pipefail
printf '%q ' "$@" > "${sendLog}"
printf '\\n' >> "${sendLog}"
`,
    );

    const { stdout, stderr } = await execFile("bash", [WAIT_SCRIPT_PATH, signalName, resultPath], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_TASK_DIR: taskDir,
        KUMA_SURFACES_PATH: surfacesPath,
        KUMA_CMUX_SEND_SCRIPT: sendScriptPath,
        KUMA_REPO_ROOT: root,
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_USER_MEMO_DIR: join(root, "user-memo"),
      },
    });

    const sendLogContents = await readFile(sendLog, "utf8");
    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
    expect(stdout).toContain(`RESULT_FILE: ${resultPath}`);
    expect(stderr).toContain("AUTO_INGEST:");
    expect(stderr).toContain("NOEURI_TRIGGER: surface=surface:46");
    expect(sendLogContents).toContain("surface:46");
    expect(sendLogContents).toContain("task: kuma-task-allowlist-noeuri-phase4.");
    expect(sendLogContents).toContain(`plan: ${planPath}`);
    expect(sendLogContents).toContain(`${root}/.claude/skills/noeuri/skill.md`);
    expect(sendLogContents).toContain("protected user-memo read-only notebook");
    expect(sendLogContents).toContain(`${root}/user-memo`);
    expect(sendLogContents).toContain("Never write, rewrite, move, rename, or delete anything under that directory");
    expect(sendLogContents).toContain("Ignore stale migration briefs that suggest moving or deleting memory/ files");
    expect(sendLogContents).toContain("/tmp/kuma-results/noeuri-audit-kuma-task-allowlist-noeuri-phase4.result.md");
    expect(sendLogContents).toContain("/tmp/kuma-signals/noeuri-auto-kuma-task-allowlist-noeuri-phase4-done");
  });

  it("prints the Noeuri audit report when a noeuri-auto signal completes", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const signalDir = join(root, "signals");
    const resultDir = join(root, "results");
    const resultPath = join(resultDir, "noeuri-audit-kuma-task-allowlist-noeuri-phase4.result.md");
    const signalName = "noeuri-auto-kuma-task-allowlist-noeuri-phase4-done";

    await mkdir(signalDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });

    await writeFile(join(signalDir, signalName), "done\n", "utf8");
    await writeFile(
      resultPath,
      `## Input Context\n- task: kuma-task-allowlist-noeuri-phase4\n\n## Findings\n- audit body\n`,
      "utf8",
    );

    const { stdout, stderr } = await execFile("bash", [WAIT_SCRIPT_PATH, signalName, resultPath], {
      env: {
        ...process.env,
        KUMA_AUTO_VAULT_INGEST: "0",
        KUMA_RESULT_DIR: resultDir,
        KUMA_SIGNAL_DIR: signalDir,
      },
    });

    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
    expect(stderr).toContain(`NOEURI_AUDIT_REPORT: file=${resultPath}`);
    expect(stderr).toContain("NOEURI_AUDIT_REPORT: ## Input Context");
    expect(stderr).toContain("NOEURI_AUDIT_REPORT: - audit body");
  });

  it("records the dispatched -> worker-done -> qa-passed lifecycle in vault special files", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const taskDir = join(root, "tasks");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const vaultDir = join(root, "vault");
    const resultPath = join(resultDir, "trusted.result.md");
    const taskPath = join(taskDir, "trusted.task.md");
    const signalName = "kuma-studio-trusted-done";

    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);

    await writeFile(
      taskPath,
      `---
id: tookdaki-20260409-180729
project: kuma-studio
initiator: surface:1
worker: surface:18
qa: worker-self-report
signal: ${signalName}
result: ${resultPath}
thread_id: discord:thread-123
session_id: workspace:1/surface:1
channel_id: discord:thread-123
---
# trusted-task

Implement lifecycle hook
`,
      "utf8",
    );

    await execFile("bash", [WAIT_SCRIPT_PATH, "--vault-hook", "dispatched", "--task-file", taskPath, "--summary", "Implement lifecycle hook"], {
      env: {
        ...process.env,
        KUMA_VAULT_DIR: vaultDir,
      },
    });

    await writeFile(resultPath, "trusted: worker-self-report\n# done\n", "utf8");
    await writeFile(join(signalDir, signalName), "done\n", "utf8");

    const { stdout } = await execFile("bash", [WAIT_SCRIPT_PATH, signalName, resultPath], {
      env: {
        ...process.env,
        KUMA_AUTO_VAULT_INGEST: "0",
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_TASK_DIR: taskDir,
        KUMA_VAULT_DIR: vaultDir,
      },
    });

    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);

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

    expect(parseFrontmatter(currentFocus).type).toBe("special/current-focus");
    expect(parseFrontmatter(dispatchLog).type).toBe("special/dispatch-log");
    expect(parseFrontmatter(threadMap).type).toBe("special/thread-map");
  });

  it("records qa-rejected state and blocker when the result contains a QA reject marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const taskDir = join(root, "tasks");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const vaultDir = join(root, "vault");
    const resultPath = join(resultDir, "reject.result.md");
    const taskPath = join(taskDir, "reject.task.md");
    const signalName = "kuma-studio-reject-done";

    await mkdir(binDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
if [ "$1" = "wait-for" ]; then
  exit 1
fi
exit 0
`,
    );

    await writeFile(
      taskPath,
      `---
id: tookdaki-20260409-180729
project: kuma-studio
initiator: surface:1
worker: surface:18
qa: surface:17
signal: ${signalName}
result: ${resultPath}
thread_id: discord:thread-456
session_id: workspace:1/surface:1
channel_id: discord:thread-456
---
# reject-task

Implement lifecycle hook
`,
      "utf8",
    );

    await execFile("bash", [WAIT_SCRIPT_PATH, "--vault-hook", "dispatched", "--task-file", taskPath, "--summary", "Implement lifecycle hook"], {
      env: {
        ...process.env,
        KUMA_VAULT_DIR: vaultDir,
      },
    });

    await writeFile(resultPath, "## QA 결과\n- ❌ QA REJECT: missing regression\n", "utf8");

    await expect(execFile("bash", [WAIT_SCRIPT_PATH, signalName, resultPath, "--timeout", "1"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_AUTO_VAULT_INGEST: "0",
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_TASK_DIR: taskDir,
        KUMA_VAULT_DIR: vaultDir,
      },
    })).rejects.toMatchObject({ code: 1 });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    const dispatchLog = await readFile(join(vaultDir, "dispatch-log.md"), "utf8");
    const threadMap = await readFile(join(vaultDir, "thread-map.md"), "utf8");

    expect(currentFocus).toContain("state: qa-rejected");
    expect(currentFocus).toContain("blocker: missing regression");
    expect(dispatchLog).toContain("state=qa-rejected");
    expect(threadMap).toContain("status: qa-rejected");

    expect(parseFrontmatter(currentFocus).type).toBe("special/current-focus");
    expect(parseFrontmatter(dispatchLog).type).toBe("special/dispatch-log");
    expect(parseFrontmatter(threadMap).type).toBe("special/thread-map");
  });

  it("records failed state and blocker when liveness detects a dead worker surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const taskDir = join(root, "tasks");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const vaultDir = join(root, "vault");
    const resultPath = join(resultDir, "dead.result.md");
    const taskPath = join(taskDir, "dead.task.md");
    const signalName = "kuma-studio-dead-done";

    await mkdir(binDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
case "$1" in
  wait-for)
    exit 1
    ;;
  tree)
    printf 'workspace:1\\n  surface:18\\n'
    ;;
  read-screen)
    echo "surface:18 not found" >&2
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
`,
    );

    await writeFile(
      taskPath,
      `---
id: tookdaki-20260409-180729
project: kuma-studio
initiator: surface:1
worker: surface:18
qa: surface:17
signal: ${signalName}
result: ${resultPath}
thread_id: discord:thread-789
session_id: workspace:1/surface:1
channel_id: discord:thread-789
---
# dead-task

Implement lifecycle hook
`,
      "utf8",
    );

    await execFile("bash", [WAIT_SCRIPT_PATH, "--vault-hook", "dispatched", "--task-file", taskPath, "--summary", "Implement lifecycle hook"], {
      env: {
        ...process.env,
        KUMA_VAULT_DIR: vaultDir,
      },
    });

    await expect(execFile("bash", [WAIT_SCRIPT_PATH, signalName, resultPath, "--surface", "surface:18", "--timeout", "1"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_AUTO_VAULT_INGEST: "0",
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_TASK_DIR: taskDir,
        KUMA_VAULT_DIR: vaultDir,
      },
    })).rejects.toMatchObject({ code: 1 });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");
    const dispatchLog = await readFile(join(vaultDir, "dispatch-log.md"), "utf8");
    const threadMap = await readFile(join(vaultDir, "thread-map.md"), "utf8");
    const result = await readFile(resultPath, "utf8");

    expect(result).toContain("# ERROR: Worker Down");
    expect(currentFocus).toContain("state: failed");
    expect(currentFocus).toContain("worker down");
    expect(dispatchLog).toContain("state=failed");
    expect(threadMap).toContain("status: failed");

    expect(parseFrontmatter(currentFocus).type).toBe("special/current-focus");
    expect(parseFrontmatter(dispatchLog).type).toBe("special/dispatch-log");
    expect(parseFrontmatter(threadMap).type).toBe("special/thread-map");
  });

  it("treats prompt plus bypass footer surfaces as idle during liveness checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const resultPath = join(resultDir, "idle.result.md");
    const signalName = "kuma-studio-idle-footer-done";

    await mkdir(binDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
case "$1" in
  wait-for)
    exit 1
    ;;
  tree)
    printf 'workspace:1\\n  surface:18\\n'
    ;;
  read-screen)
    printf '───────────────────────────\\n❯\\n───────────────────────────\\n  ⏵⏵ bypass permissions on /tmp\\n  Now using extra usage\\n'
    ;;
  *)
    exit 0
    ;;
esac
`,
    );

    await expect(execFile("bash", [WAIT_SCRIPT_PATH, signalName, resultPath, "--surface", "surface:18", "--timeout", "1"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_AUTO_VAULT_INGEST: "0",
        KUMA_AUTO_NOEURI_TRIGGER: "0",
        KUMA_SIGNAL_DIR: signalDir,
      },
    })).rejects.toMatchObject({ code: 2 });

    const result = await readFile(resultPath, "utf8");
    expect(result).toContain("# ERROR: Worker Idle Without Signal");
    expect(result).not.toContain("bypass permissions");
  });

  it("emits a warning when fast vault lint fails without blocking lifecycle updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const taskDir = join(root, "tasks");
    const vaultDir = join(root, "vault");
    const taskPath = join(taskDir, "warn.task.md");

    await mkdir(taskDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);

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

    await writeFile(
      taskPath,
      `---
id: tookdaki-20260409-190014
project: kuma-studio
initiator: surface:1
worker: surface:18
qa: worker-self-report
signal: kuma-studio-warn-done
result: /tmp/kuma-results/warn.result.md
thread_id: discord:thread-warn
session_id: workspace:1/surface:1
channel_id: discord:thread-warn
---
# warn-task

Lint integration
`,
      "utf8",
    );

    const { stderr } = await execFile("bash", [WAIT_SCRIPT_PATH, "--vault-hook", "dispatched", "--task-file", taskPath, "--summary", "Lint integration"], {
      env: {
        ...process.env,
        KUMA_VAULT_DIR: vaultDir,
      },
    });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");

    expect(stderr).toContain("VAULT_HOOK_WARN: fast lint failed for decisions.md");
    expect(currentFocus).toContain("task_id: tookdaki-20260409-190014");
  });

  it("resolves fast lint from the canonical repo root when invoked through a symlink outside the repo cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const homeDir = join(root, "home");
    const cmuxDir = join(homeDir, ".kuma", "cmux");
    const taskDir = join(root, "tasks");
    const vaultDir = join(root, "vault");
    const workspaceDir = join(root, "workspace");
    const taskPath = join(taskDir, "symlink.task.md");
    const symlinkWaitPath = join(cmuxDir, "kuma-cmux-wait.sh");

    await mkdir(cmuxDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);
    await symlink(WAIT_SCRIPT_PATH, symlinkWaitPath);

    await writeFile(
      taskPath,
      `---
id: tookdaki-20260409-214924
project: kuma-studio
initiator: surface:1
worker: surface:18
qa: worker-self-report
signal: kuma-studio-symlink-done
result: /tmp/kuma-results/symlink.result.md
thread_id: discord:thread-symlink
session_id: workspace:1/surface:1
channel_id: discord:thread-symlink
---
# symlink-task

Fast lint path fix
`,
      "utf8",
    );

    const { stderr } = await execFile("bash", [symlinkWaitPath, "--vault-hook", "dispatched", "--task-file", taskPath, "--summary", "Fast lint path fix"], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        HOME: homeDir,
        KUMA_VAULT_DIR: vaultDir,
      },
    });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");

    expect(stderr).toBe("");
    expect(currentFocus).toContain("task_id: tookdaki-20260409-214924");
    expect(currentFocus).toContain("state: dispatched");
  });

  it("disables fast vault lint together with the lifecycle hook when KUMA_DISABLE_VAULT_HOOK=1", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const taskDir = join(root, "tasks");
    const vaultDir = join(root, "vault");
    const taskPath = join(taskDir, "disabled.task.md");

    await mkdir(taskDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    await writeVaultLifecycleStubFiles(vaultDir);

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

    await writeFile(
      taskPath,
      `---
id: tookdaki-20260409-190014
project: kuma-studio
initiator: surface:1
worker: surface:18
qa: worker-self-report
signal: kuma-studio-disabled-done
result: /tmp/kuma-results/disabled.result.md
thread_id: discord:thread-disabled
session_id: workspace:1/surface:1
channel_id: discord:thread-disabled
---
# disabled-task

Lint integration
`,
      "utf8",
    );

    const { stderr } = await execFile("bash", [WAIT_SCRIPT_PATH, "--vault-hook", "dispatched", "--task-file", taskPath, "--summary", "Disabled integration"], {
      env: {
        ...process.env,
        KUMA_DISABLE_VAULT_HOOK: "1",
        KUMA_VAULT_DIR: vaultDir,
      },
    });

    const currentFocus = await readFile(join(vaultDir, "current-focus.md"), "utf8");

    expect(stderr).toBe("");
    expect(currentFocus).toContain("active_count: 0");
    expect(currentFocus).not.toContain("tookdaki-20260409-190014");
  });
});
