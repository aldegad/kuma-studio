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
const KUMA_SERVER_RELOAD_PATH = resolve(process.cwd(), "scripts/bin/kuma-server-reload");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

describe("cmux send enforcement scripts", { timeout: 30_000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("submits prompts atomically with an attached Enter escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const cmuxLog = join(root, "cmux.log");
    const sendLog = join(root, "kuma-send.log");
    const sendPayloadPath = join(root, "send-payload.txt");
    const prompt = "HOWL-BAMTORI-ACK";

    await mkdir(binDir, { recursive: true });

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
    if [ ! -f "${sendPayloadPath}" ]; then
      printf '  ❯\\n'
    else
      printf 'Running task\\n'
    fi
    ;;
  send)
    printf '%s' "\${*: -1}" > "${sendPayloadPath}"
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
    const sendPayload = await readFile(sendPayloadPath, "utf8");

    expect(cmuxLogContents).toContain("send|--workspace workspace:1 --surface surface:9");
    expect(sendPayload.endsWith("\\r")).toBe(true);
    expect(cmuxLogContents).not.toContain("send-key|");
    expect(sendLogContents).toContain("\tpre-send\t");
    expect(sendLogContents).toContain("\tdispatch\t");
    expect(sendLogContents).toContain("\tdelivered\t");
  }, 60_000);


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
  send)
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
    expect(sendLogContents).toContain("\tobserve-unchanged\t");
    expect(sendLogContents).toContain("\tfailed\t");
    expect(sendLogContents).not.toContain("\tdelivered\t");
  });

  it("retries transient cmux send failures when a fresh surface is not ready yet", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const cmuxLog = join(root, "cmux.log");
    const sendLog = join(root, "kuma-send.log");
    const sendCountPath = join(root, "send-count.txt");
    const readCountPath = join(root, "read-count.txt");

    await mkdir(binDir, { recursive: true });
    await writeFile(sendCountPath, "0", "utf8");
    await writeFile(readCountPath, "0", "utf8");

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
      printf 'Error: internal_error: ERROR: Terminal surface not found\\n'
    else
      printf 'Running task\\n'
    fi
    ;;
  send)
    count=$(cat "${sendCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${sendCountPath}"
    if [ "$count" -eq 1 ]; then
      printf 'Error: internal_error: ERROR: Terminal surface not found\\n' >&2
      exit 1
    fi
    ;;
esac
`,
    );

    await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "retry me"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SEND_LOG_PATH: sendLog,
      },
    });

    const sendLogContents = await readFile(sendLog, "utf8");
    const sendCount = Number((await readFile(sendCountPath, "utf8")).trim());

    expect(sendCount).toBe(2);
    expect(sendLogContents).toContain("\tdispatch-retry-1\t");
    expect(sendLogContents).toContain("\tdelivered\t");
  });

  it("does not treat broken-pipe transport errors as delivered prompts", async () => {
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
      printf 'Error: Failed to write to socket (Broken pipe, errno 32)\\n'
    fi
    ;;
  send)
    ;;
esac
`,
    );

    let failure;
    try {
      await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "retry broken pipe"], {
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
    expect(`${failure.stderr}`).toContain("transport error after send");

    const sendLogContents = await readFile(sendLog, "utf8");
    expect(sendLogContents).toContain("\tpost-send-transport-error\t");
    expect(sendLogContents).toContain("\tfailed\t");
    expect(sendLogContents).not.toContain("\tdelivered\t");
  });

  it("routes helper scripts and kuma-task through the send wrapper instead of raw cmux send", async () => {
    for (const filePath of [SPAWN_SCRIPT_PATH, PROJECT_INIT_SCRIPT_PATH, BOOTSTRAP_SCRIPT_PATH, KUMA_TASK_PATH, KUMA_SERVER_RELOAD_PATH]) {
      const source = await readFile(filePath, "utf8");
      expect(source).toContain("kuma-cmux-send.sh");
      expect(source).not.toMatch(/^\s*cmux send\b/mu);
      expect(source).not.toMatch(/^\s*cmux send-key\b/mu);
      if (filePath === BOOTSTRAP_SCRIPT_PATH) {
        expect(source).toContain("KUMA_STUDIO_WORKSPACE=%q npm run server:reload");
      }
    }
  });
});
