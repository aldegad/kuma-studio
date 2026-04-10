import { chmod, mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

const WATCHDOG_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-noeuri-watchdog.sh");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

describe("cmux Noeuri watchdog script", { timeout: 30_000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("dispatches a trusted Noeuri ingest task once for new non-Noeuri results", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-noeuri-watchdog-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const resultDir = join(root, "results");
    const logPath = join(root, "watchdog.log");
    const taskLogPath = join(root, "task.log");
    const stampPath = join(root, "last-ingest.timestamp");

    await mkdir(binDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });

    await writeFile(join(resultDir, "alpha.result.md"), "# alpha\n", "utf8");
    await writeFile(join(resultDir, "kuma-studio-noeuri-20260410-160000.result.md"), "# self\n", "utf8");
    await writeFile(join(resultDir, "noeuri-audit-alpha.result.md"), "# audit\n", "utf8");

    await writeExecutable(
      join(binDir, "kuma-task"),
      `#!/bin/bash
set -euo pipefail
for arg in "$@"; do
  printf 'ARG:%s\\n' "$arg" >> "${taskLogPath}"
done
`,
    );

    await execFile("bash", [WATCHDOG_SCRIPT_PATH, "--once"], {
      env: {
        ...process.env,
        KUMA_RESULT_DIR: resultDir,
        KUMA_NOEURI_LAST_INGEST_TIMESTAMP: stampPath,
        KUMA_TASK_BIN_PATH: join(binDir, "kuma-task"),
        KUMA_NOEURI_WATCHDOG_LOG_PATH: logPath,
      },
    });

    const taskLog = await readFile(taskLogPath, "utf8");
    const stampStats = await stat(stampPath);

    expect(taskLog).toContain("ARG:noeuri");
    expect(taskLog).toContain("ARG:--project");
    expect(taskLog).toContain("ARG:kuma-studio");
    expect(taskLog).toContain("ARG:--trust-worker");
    expect(taskLog).toContain("ARG:미처리 result 인제스트");
    expect(taskLog).toContain("alpha.result.md");
    expect(taskLog).not.toContain("kuma-studio-noeuri-20260410-160000.result.md");
    expect(taskLog).not.toContain("noeuri-audit-alpha.result.md");
    expect(stampStats.mtimeMs).toBeGreaterThan(0);

    await execFile("bash", [WATCHDOG_SCRIPT_PATH, "--once"], {
      env: {
        ...process.env,
        KUMA_RESULT_DIR: resultDir,
        KUMA_NOEURI_LAST_INGEST_TIMESTAMP: stampPath,
        KUMA_TASK_BIN_PATH: join(binDir, "kuma-task"),
        KUMA_NOEURI_WATCHDOG_LOG_PATH: logPath,
      },
    });

    const taskLogAfterSecondRun = await readFile(taskLogPath, "utf8");
    const dispatchCount = taskLogAfterSecondRun.split("\n").filter((line) => line === "ARG:noeuri").length;
    expect(dispatchCount).toBe(1);
  });

  it("skips backlog when only Noeuri-owned or already-stamped results are present", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-noeuri-watchdog-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const resultDir = join(root, "results");
    const logPath = join(root, "watchdog.log");
    const taskLogPath = join(root, "task.log");
    const stampPath = join(root, "last-ingest.timestamp");

    await mkdir(binDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });

    await writeFile(stampPath, "", "utf8");
    await writeFile(join(resultDir, "older.result.md"), "# older\n", "utf8");
    await writeFile(join(resultDir, "kuma-studio-noeuri-20260410-160000.result.md"), "# self\n", "utf8");
    await writeFile(join(resultDir, "noeuri-audit-alpha.result.md"), "# audit\n", "utf8");

    const oldDate = new Date("2026-04-10T15:00:00.000Z");
    const newStampDate = new Date("2026-04-10T16:00:00.000Z");
    await utimes(join(resultDir, "older.result.md"), oldDate, oldDate);
    await utimes(join(resultDir, "kuma-studio-noeuri-20260410-160000.result.md"), newStampDate, newStampDate);
    await utimes(join(resultDir, "noeuri-audit-alpha.result.md"), newStampDate, newStampDate);
    await utimes(stampPath, newStampDate, newStampDate);

    await writeExecutable(
      join(binDir, "kuma-task"),
      `#!/bin/bash
set -euo pipefail
printf 'called\\n' >> "${taskLogPath}"
`,
    );

    await execFile("bash", [WATCHDOG_SCRIPT_PATH, "--once"], {
      env: {
        ...process.env,
        KUMA_RESULT_DIR: resultDir,
        KUMA_NOEURI_LAST_INGEST_TIMESTAMP: stampPath,
        KUMA_TASK_BIN_PATH: join(binDir, "kuma-task"),
        KUMA_NOEURI_WATCHDOG_LOG_PATH: logPath,
      },
    });

    await expect(readFile(taskLogPath, "utf8")).rejects.toThrow();
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("no pending result backlog");
  });

  it("keeps the stamp unchanged when the Noeuri dispatch fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-noeuri-watchdog-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const resultDir = join(root, "results");
    const logPath = join(root, "watchdog.log");
    const stampPath = join(root, "last-ingest.timestamp");

    await mkdir(binDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });

    await writeFile(stampPath, "", "utf8");
    await writeFile(join(resultDir, "fresh.result.md"), "# fresh\n", "utf8");

    const oldStampDate = new Date("2026-04-10T15:00:00.000Z");
    const freshDate = new Date("2026-04-10T16:00:00.000Z");
    await utimes(stampPath, oldStampDate, oldStampDate);
    await utimes(join(resultDir, "fresh.result.md"), freshDate, freshDate);

    await writeExecutable(
      join(binDir, "kuma-task"),
      `#!/bin/bash
set -euo pipefail
echo "dispatch boom" >&2
exit 1
`,
    );

    await execFile("bash", [WATCHDOG_SCRIPT_PATH, "--once"], {
      env: {
        ...process.env,
        KUMA_RESULT_DIR: resultDir,
        KUMA_NOEURI_LAST_INGEST_TIMESTAMP: stampPath,
        KUMA_TASK_BIN_PATH: join(binDir, "kuma-task"),
        KUMA_NOEURI_WATCHDOG_LOG_PATH: logPath,
      },
    });

    const stampStats = await stat(stampPath);
    const log = await readFile(logPath, "utf8");

    expect(Math.trunc(stampStats.mtimeMs)).toBe(Math.trunc(oldStampDate.getTime()));
    expect(log).toContain("dispatch failed; stamp left unchanged");
    expect(log).toContain("dispatch boom");
  });
});
