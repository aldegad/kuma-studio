import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

const WAIT_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-wait.sh");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

describe("cmux wait script", () => {
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

    await writeFile(join(signalDir, signalName), "done\n", "utf8");
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
      },
    });

    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
    expect(stdout).toContain(`RESULT_FILE: ${resultPath}`);
    expect(stdout).toContain("- result body");
    expect(stderr).toContain("AUTO_INGEST_FAILED: ingest boom");
    expect(stderr).not.toContain("NOEURI_TRIGGER:");
    await expect(readFile(sendLog, "utf8")).rejects.toThrow();
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

    await writeFile(join(signalDir, signalName), "done\n", "utf8");
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
});
