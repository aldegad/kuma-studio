import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

const SEND_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-send.sh");
const SPAWN_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-spawn.sh");
const PROJECT_INIT_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-project-init.sh");
const BOOTSTRAP_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-bootstrap.sh");
const KUMA_TASK_PATH = resolve(process.cwd(), "scripts/bin/kuma-task");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

describe("cmux send enforcement scripts", { timeout: 30_000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("retries Enter for a pending Codex-style prompt and logs the dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const cmuxLog = join(root, "cmux.log");
    const sendLog = join(root, "kuma-send.log");
    const readCountPath = join(root, "read-count.txt");
    const sendKeyCountPath = join(root, "send-key-count.txt");
    const prompt = "HOWL-BAMTORI-ACK";

    await mkdir(binDir, { recursive: true });
    await writeFile(readCountPath, "0", "utf8");
    await writeFile(sendKeyCountPath, "0", "utf8");

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
printf '%s|' "$command" >> "${cmuxLog}"
shift || true
printf '%q ' "$@" >> "${cmuxLog}"
printf '\\n' >> "${cmuxLog}"
case "$command" in
  tree)
    printf 'workspace:1\\n  surface:9\\n'
    ;;
  read-screen)
    count=$(cat "${readCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${readCountPath}"
    if [ "$count" -eq 1 ]; then
      printf '  ❯\\n'
    elif [ "$count" -eq 2 ]; then
      printf '  > ${prompt}\\n'
    else
      printf 'Running task\\n'
    fi
    ;;
  send-key)
    count=$(cat "${sendKeyCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${sendKeyCountPath}"
    ;;
esac
`,
    );

    await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", prompt], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SEND_LOG_PATH: sendLog,
      },
    });

    const cmuxLogContents = await readFile(cmuxLog, "utf8");
    const sendLogContents = await readFile(sendLog, "utf8");
    const sendKeyCount = Number((await readFile(sendKeyCountPath, "utf8")).trim());

    expect(cmuxLogContents).toContain("send|--workspace workspace:1 --surface surface:9");
    expect(sendKeyCount).toBe(2);
    expect(sendLogContents).toContain("\tpre-send\t");
    expect(sendLogContents).toContain("\tdispatch\t");
    expect(sendLogContents).toContain("\tretry-enter\t");
    expect(sendLogContents).toContain("\tdelivered\t");
  }, 30_000);

  it("dismisses an idle Codex suggestion with Escape before dispatching the prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const cmuxLog = join(root, "cmux.log");
    const sendLog = join(root, "kuma-send.log");
    const readCountPath = join(root, "read-count.txt");
    const sendKeyLogPath = join(root, "send-key.log");
    const prompt = "Read /tmp/fake.task.md and execute";

    await mkdir(binDir, { recursive: true });
    await writeFile(readCountPath, "0", "utf8");
    await writeFile(sendKeyLogPath, "", "utf8");

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
printf '%s|' "$command" >> "${cmuxLog}"
shift || true
printf '%q ' "$@" >> "${cmuxLog}"
printf '\\n' >> "${cmuxLog}"
case "$command" in
  tree)
    printf 'workspace:1\\n  surface:9\\n'
    ;;
  read-screen)
    count=$(cat "${readCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${readCountPath}"
    if [ "$count" -eq 1 ]; then
      printf '› Implement {feature}\\n'
    elif [ "$count" -eq 2 ]; then
      printf '›\\n'
    else
      printf 'Running task\\n'
    fi
    ;;
  send-key)
    printf '%s\\n' "$*" >> "${sendKeyLogPath}"
    ;;
esac
`,
    );

    await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", prompt], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SEND_LOG_PATH: sendLog,
      },
    });

    const cmuxLogContents = await readFile(cmuxLog, "utf8");
    const sendLogContents = await readFile(sendLog, "utf8");
    const sendKeyLogContents = await readFile(sendKeyLogPath, "utf8");

    expect(sendKeyLogContents).toContain("--workspace workspace:1 --surface surface:9 Escape");
    expect(sendKeyLogContents).toContain("--workspace workspace:1 --surface surface:9 Enter");
    expect(cmuxLogContents).toContain("send|--workspace workspace:1 --surface surface:9");
    expect(sendLogContents).toContain("\tdismiss-suggestion\t");
    expect(sendLogContents).toContain("\tdismissed-suggestion\t");
    expect(sendLogContents).toContain("\tpre-send\t");
    expect(sendLogContents).toContain("\tdelivered\t");
  }, 30_000);

  it("fails when the screen snapshot does not change after dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const sendLog = join(root, "kuma-send.log");

    await mkdir(binDir, { recursive: true });

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  tree)
    printf 'workspace:1\\n  surface:9\\n'
    ;;
  read-screen)
    printf '❯\\n'
    ;;
  send|send-key)
    ;;
esac
`,
    );

    let failure;
    try {
      await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "Read /tmp/fake.task.md and execute"], {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          KUMA_SEND_LOG_PATH: sendLog,
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(1);
    expect(`${failure.stderr}`).toContain("ERROR: Prompt delivery failed");

    const sendLogContents = await readFile(sendLog, "utf8");
    expect(sendLogContents).toContain("\tretry-unchanged\t");
    expect(sendLogContents).toContain("\tfailed\t");
    expect(sendLogContents).not.toContain("\tdelivered\t");
  });

  it("fails when a non-empty suggestion line remains after dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const sendLog = join(root, "kuma-send.log");
    const readCountPath = join(root, "read-count.txt");

    await mkdir(binDir, { recursive: true });
    await writeFile(readCountPath, "0", "utf8");

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  tree)
    printf 'workspace:1\\n  surface:9\\n'
    ;;
  read-screen)
    count=$(cat "${readCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${readCountPath}"
    if [ "$count" -eq 1 ]; then
      printf '❯\\n'
    else
      printf '› Improve documentation in @filename\\n'
    fi
    ;;
  send|send-key)
    ;;
esac
`,
    );

    let failure;
    try {
      await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "Read /tmp/fake.task.md and execute"], {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          KUMA_SEND_LOG_PATH: sendLog,
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(1);

    const sendLogContents = await readFile(sendLog, "utf8");
    expect(sendLogContents).toContain("\tretry-suggestion\t");
    expect(sendLogContents).toContain("\tfailed\t");
    expect(sendLogContents).not.toContain("\tdelivered\t");
  });

  it("routes helper scripts and kuma-task through the send wrapper instead of raw cmux send", async () => {
    for (const filePath of [SPAWN_SCRIPT_PATH, PROJECT_INIT_SCRIPT_PATH, BOOTSTRAP_SCRIPT_PATH, KUMA_TASK_PATH]) {
      const source = await readFile(filePath, "utf8");
      expect(source).toContain("kuma-cmux-send.sh");
      expect(source).not.toMatch(/^\s*cmux send\b/mu);
      expect(source).not.toMatch(/^\s*cmux send-key\b/mu);
    }
  });
});
