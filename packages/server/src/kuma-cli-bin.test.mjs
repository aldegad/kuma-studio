import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

const KUMA_TASK_PATH = resolve(process.cwd(), "scripts/bin/kuma-task");
const KUMA_READ_PATH = resolve(process.cwd(), "scripts/bin/kuma-read");
const KUMA_STATUS_PATH = resolve(process.cwd(), "scripts/bin/kuma-status");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function setupCliSandbox() {
  const root = await mkdtemp(join(tmpdir(), "kuma-cli-bin-"));
  const home = join(root, "home");
  const kumaDir = join(home, ".kuma");
  const cmuxDir = join(kumaDir, "cmux");
  const binDir = join(root, "bin");
  const taskDir = join(root, "tasks");
  const resultDir = join(root, "results");
  const outputDir = join(root, "read-output");
  const surfacesPath = join(root, "surfaces.json");
  const cmuxLog = join(root, "cmux.log");

  await mkdir(cmuxDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(taskDir, { recursive: true });
  await mkdir(resultDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  await writeFile(
    join(kumaDir, "team-config.json"),
    `${JSON.stringify({
      members: {
        "뚝딱이": { id: "tookdaki", emoji: "🦫", type: "codex", team: "dev" },
        "쿤": { id: "koon", emoji: "🦝", type: "claude", team: "dev" },
        "밤토리": { id: "bamdori", emoji: "🦔", type: "claude", team: "dev" },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await writeFile(
    surfacesPath,
    `${JSON.stringify({
      "kuma-studio": {
        "🦫 뚝딱이": "surface:4",
        "🦝 쿤": "surface:16",
        "🦔 밤토리": "surface:7",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await writeExecutable(
    join(binDir, "cmux"),
    `#!/bin/bash
set -euo pipefail
command="$1"
printf '%s|' "$command" >> "${cmuxLog}"
shift || true
printf '%q ' "$@" >> "${cmuxLog}"
printf '\\n' >> "${cmuxLog}"
case "$command" in
  *)
    ;;
esac
if [ "$command" = "wait-for" ]; then
  echo "OK"
fi
`,
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-read.sh"),
    `#!/bin/bash
set -euo pipefail
surface="$1"
cat "${outputDir}/$(printf '%s' "$surface" | tr ':' '_').txt"
`,
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-wait.sh"),
    `#!/bin/bash
set -euo pipefail
printf '%q ' "$@" > "${join(root, "wait.log")}"
printf '\\n' >> "${join(root, "wait.log")}"
echo "SIGNAL_RECEIVED: $1"
`,
  );

  return {
    root,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${binDir}:${process.env.PATH}`,
      KUMA_SURFACES_PATH: surfacesPath,
      KUMA_TASK_DIR: taskDir,
      KUMA_RESULT_DIR: resultDir,
      KUMA_INITIATOR_SURFACE: "surface:99",
    },
    cmuxLog,
    taskDir,
    outputDir,
    waitLog: join(root, "wait.log"),
  };
}

async function runScript(scriptPath, args, env) {
  return execFile("bash", [scriptPath, ...args], { env });
}

describe("kuma CLI bin scripts", () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("kuma-task sends Enter only for codex members and writes a task file", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    const taskFile = await readFile(taskFilePath, "utf8");
    expect(taskFile).toContain("worker: surface:4");
    expect(taskFile).toContain("qa: surface:7");
    expect(taskFile).toContain("echo test");

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send|--surface surface:4");
    expect(cmuxLog).toContain("send-key|--surface surface:4 Enter");
  });

  it("kuma-task does not send Enter for claude members", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["쿤", "echo test", "--project", "kuma-studio"], sandbox.env);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send|--surface surface:16");
    expect(cmuxLog).not.toContain("send-key|--surface surface:16 Enter");
  });

  it("kuma-read resolves a member by id and tails the requested number of lines", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(
      join(sandbox.outputDir, "surface_4.txt"),
      "line-1\nline-2\nline-3\nline-4\n",
      "utf8",
    );

    const { stdout } = await runScript(KUMA_READ_PATH, ["tookdaki", "--project", "kuma-studio", "--lines", "2"], sandbox.env);
    expect(stdout.trim()).toBe("line-3\nline-4");
  });

  it("kuma-status prints member statuses for the selected project", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(join(sandbox.outputDir, "surface_4.txt"), "Investigating sofa bug\n", "utf8");
    await writeFile(join(sandbox.outputDir, "surface_16.txt"), "❯\n", "utf8");
    await writeFile(join(sandbox.outputDir, "surface_7.txt"), "new task? /clear to save 12k tokens\n", "utf8");

    const { stdout } = await runScript(KUMA_STATUS_PATH, ["--project", "kuma-studio"], sandbox.env);

    expect(stdout).toContain("PROJECT\tMEMBER\tSURFACE\tSTATUS\tPREVIEW");
    expect(stdout).toContain("kuma-studio\t🦫 뚝딱이\tsurface:4\tworking\tInvestigating sofa bug");
    expect(stdout).toContain("kuma-studio\t🦝 쿤\tsurface:16\tidle");
    expect(stdout).toContain("kuma-studio\t🦔 밤토리\tsurface:7\tidle");
  });
});
