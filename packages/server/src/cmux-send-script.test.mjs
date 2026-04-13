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

  it("submits prompts with a separate Enter key after the paste settles", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const cmuxLog = join(root, "cmux.log");
    const sendLog = join(root, "kuma-send.log");
    const sendPayloadPath = join(root, "send-payload.txt");
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
    elif [ "$count" -le 3 ]; then
      printf '  > ${prompt}\\n'
    else
      printf 'Running task\\n'
    fi
    ;;
  send)
    printf '%s' "\${*: -1}" > "${sendPayloadPath}"
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
    const sendPayload = await readFile(sendPayloadPath, "utf8");
    const sendKeyCount = Number((await readFile(sendKeyCountPath, "utf8")).trim());

    expect(cmuxLogContents).toContain("send|--workspace workspace:1 --surface surface:9");
    expect(sendPayload).toBe(prompt);
    expect(sendKeyCount).toBe(1);
    expect(cmuxLogContents).toContain("send-key|--workspace workspace:1 --surface surface:9 Enter");
    expect(sendLogContents).toContain("\tpre-send\t");
    expect(sendLogContents).toContain("\tdispatch\t");
    expect(sendLogContents).toContain("\tpre-enter-settled\t");
    expect(sendLogContents).toContain("\tdelivered\t");
  }, 60_000);

  it("sends Enter immediately once the pasted prompt tail clears without a pending continuation", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const sendLog = join(root, "kuma-send.log");
    const readCountPath = join(root, "read-count.txt");
    const sendKeyCountPath = join(root, "send-key-count.txt");

    await mkdir(binDir, { recursive: true });
    await writeFile(readCountPath, "0", "utf8");
    await writeFile(sendKeyCountPath, "0", "utf8");

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
      printf 'Running task\\n'
    fi
    ;;
  send)
    ;;
  send-key)
    count=$(cat "${sendKeyCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${sendKeyCountPath}"
    ;;
esac
`,
    );

    await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "clear fast"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SEND_LOG_PATH: sendLog,
      },
    });

    const sendLogContents = await readFile(sendLog, "utf8");
    const sendKeyCount = Number((await readFile(sendKeyCountPath, "utf8")).trim());

    expect(sendKeyCount).toBe(1);
    expect(sendLogContents).toContain("\tpre-enter-cleared\t");
    expect(sendLogContents).toContain("\tenter-accepted-try-1\t");
    expect(sendLogContents).toContain("\tdelivered\t");
  });

  it("waits for shell continuation prompts to settle before sending Enter", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const sendLog = join(root, "kuma-send.log");
    const readCountPath = join(root, "read-count.txt");
    const sendKeyCountPath = join(root, "send-key-count.txt");
    const firstEnterReadCountPath = join(root, "first-enter-read-count.txt");

    await mkdir(binDir, { recursive: true });
    await writeFile(readCountPath, "0", "utf8");
    await writeFile(sendKeyCountPath, "0", "utf8");
    await writeFile(firstEnterReadCountPath, "", "utf8");

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
    elif [ "$count" -eq 2 ]; then
      printf 'cmdand quote> partial 1\\n'
    elif [ "$count" -le 4 ]; then
      printf 'cmdand quote> partial 2\\n'
    else
      printf 'Running task\\n'
    fi
    ;;
  send)
    ;;
  send-key)
    count=$(cat "${sendKeyCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${sendKeyCountPath}"
    if [ "$count" -eq 1 ]; then
      cat "${readCountPath}" > "${firstEnterReadCountPath}"
    fi
    ;;
esac
`,
    );

    await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "long startup"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SEND_LOG_PATH: sendLog,
      },
    });

    const sendLogContents = await readFile(sendLog, "utf8");
    const firstEnterReadCount = Number((await readFile(firstEnterReadCountPath, "utf8")).trim());

    expect(firstEnterReadCount).toBeGreaterThanOrEqual(4);
    expect(sendLogContents).toContain("\tpre-enter-settled\t");
    expect(sendLogContents).toContain("\tdelivered\t");
  });

  it("treats npm-style output lines that begin with '>' as delivered once later output appears", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const sendLog = join(root, "kuma-send.log");
    const readCountPath = join(root, "read-count.txt");
    const sendKeyCountPath = join(root, "send-key-count.txt");

    await mkdir(binDir, { recursive: true });
    await writeFile(readCountPath, "0", "utf8");
    await writeFile(sendKeyCountPath, "0", "utf8");

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
    elif [ "$count" -le 3 ]; then
      printf 'cmdand quote> npm run server:reload\\n'
    else
      printf '> bash ./scripts/server-reload.sh\\n\\nStarting kuma-studio server on http://127.0.0.1:4312\\nwatchTeamConfig registered\\nkuma-studio listening on http://127.0.0.1:4312\\nscene path: /tmp/scene.json\\n'
    fi
    ;;
  send)
    ;;
  send-key)
    count=$(cat "${sendKeyCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${sendKeyCountPath}"
    ;;
esac
`,
    );

    await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "server boot"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SEND_LOG_PATH: sendLog,
      },
    });

    const sendLogContents = await readFile(sendLog, "utf8");
    const sendKeyCount = Number((await readFile(sendKeyCountPath, "utf8")).trim());

    expect(sendKeyCount).toBe(1);
    expect(sendLogContents).toContain("\tpre-enter-settled\t");
    expect(sendLogContents).toContain("\tenter-accepted-try-1\t");
    expect(sendLogContents).toContain("\tdelivered\t");
    expect(sendLogContents).not.toContain("\tfailed\t");
  });

  it("uses short polling instead of fixed 1s/2s/3s Enter backoff once the prompt settles", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-send-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const sendLog = join(root, "kuma-send.log");
    const sleepLog = join(root, "sleep.log");
    const readCountPath = join(root, "read-count.txt");
    const sendKeyCountPath = join(root, "send-key-count.txt");

    await mkdir(binDir, { recursive: true });
    await writeFile(readCountPath, "0", "utf8");
    await writeFile(sendKeyCountPath, "0", "utf8");

    await writeExecutable(
      join(binDir, "sleep"),
      `#!/bin/bash
set -euo pipefail
printf '%s\\n' "\${1:-}" >> "${sleepLog}"
`,
    );

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
    elif [ "$count" -le 3 ]; then
      printf 'cmdand quote> startup tail\\n'
    else
      printf 'Running task\\n'
    fi
    ;;
  send)
    ;;
  send-key)
    count=$(cat "${sendKeyCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${sendKeyCountPath}"
    ;;
esac
`,
    );

    await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "quick boot"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SEND_LOG_PATH: sendLog,
      },
    });

    const sleepLogContents = await readFile(sleepLog, "utf8");
    const sendKeyCount = Number((await readFile(sendKeyCountPath, "utf8")).trim());

    expect(sendKeyCount).toBe(1);
    expect(sleepLogContents).toContain("0.2");
    expect(sleepLogContents).not.toMatch(/^(1|2|3)$/mu);
  });


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
    expect(sendLogContents).toContain("\tretry-unchanged\t");
    expect(sendLogContents).toContain("\tfailed\t");
    expect(sendLogContents).not.toContain("\tdelivered\t");
  });

  it("fails when a non-empty prompt line remains even if the screen drifts", async () => {
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
    elif [ "$count" -eq 2 ]; then
      printf '❯ Speaker: stuck prompt\\n'
    elif [ "$count" -eq 3 ]; then
      printf '❯ Speaker: stuck prompt \\n'
    else
      printf '❯ Speaker: stuck prompt\\n'
    fi
    ;;
  send|send-key)
    ;;
esac
`,
    );

    let failure;
    try {
      await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "smoke"], {
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
    expect(sendLogContents).toContain("\tretry-enter\t");
    expect(sendLogContents).toContain("\tfailed\t");
    expect(sendLogContents).not.toContain("\tdelivered\t");
  });

  it("fails when a multiline Claude-style composer remains pending inside the prompt region", async () => {
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
      printf '✻ Baked for 1m 25s\\n\\n──────────────────────────────────────────────────────\\n❯\\n──────────────────────────────────────────────────────\\n  ⏵⏵ bypass permissions on (shift+tab to cycle)\\n'
    else
      printf '✻ Baked for 1m 25s\\n\\n──────────────────────────────────────────────────────\\n❯ [Kuma Studio Dispatch] koon-20260413-171418\\n  Speaker: initiator\\n  Recipient: 쿤 (worker, claude, surface:9)\\n  Message kind: assigned task\\n  Body source: forwarded/orchestrated summary\\n\\n  [Bug Fix] TEAM 패널의 SYS 버튼 visibility 회귀\\n\\n  ## 증상\\n  TEAM 패널 (이전 CMUX 패널) 의 각 멤버 행 우측에\\n  들어간 SYS 버튼(◧ 아이콘)이 알렉스 화면에 전혀 안\\n  보임. 마우스 hover 해도 안 보임. 컬러 잘못\\n  넣었거나 group-hover 셀렉터가 안 먹는 등 디자인\\n  회귀로 보임.\\n──────────────────────────────────────────────────────\\n  ⏵⏵ bypass permissions on (shift+tab to cycle)\\n'
    fi
    ;;
  send|send-key)
    ;;
esac
`,
    );

    let failure;
    try {
      await execFile("bash", [SEND_SCRIPT_PATH, "surface:9", "multiline composer smoke"], {
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
    expect(sendLogContents).toContain("\tpre-enter-settled\t");
    expect(sendLogContents).toContain("\tretry-enter\t");
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
        expect(source).toContain("KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=%q npm run server:reload");
      }
    }
  });
});
