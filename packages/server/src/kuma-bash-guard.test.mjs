import { existsSync, readFileSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const KUMA_MODE_LOCK = "/tmp/kuma-mode.lock";
const KUMA_DISPATCH_LOCK = "/tmp/kuma-dispatch.lock";
const SCRIPT_PATH = resolve(process.cwd(), "scripts/hooks/kuma-bash-guard.sh");

let hadOriginalLock = false;
let originalLockContents = null;
let hadOriginalDispatchLock = false;
let originalDispatchLockContents = null;

async function runGuard(command, env = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn("bash", [SCRIPT_PATH], {
      env: {
        ...process.env,
        KUMA_ROLE: "master",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });

    child.stdin.end(JSON.stringify({ tool_input: { command } }));
  });
}

describe.sequential("kuma-bash-guard", () => {
  beforeAll(async () => {
    hadOriginalLock = existsSync(KUMA_MODE_LOCK);
    originalLockContents = hadOriginalLock ? readFileSync(KUMA_MODE_LOCK) : null;
    if (!hadOriginalLock) {
      await writeFile(KUMA_MODE_LOCK, "1\n", "utf8");
    }

    hadOriginalDispatchLock = existsSync(KUMA_DISPATCH_LOCK);
    originalDispatchLockContents = hadOriginalDispatchLock ? readFileSync(KUMA_DISPATCH_LOCK) : null;
    if (!hadOriginalDispatchLock) {
      await writeFile(KUMA_DISPATCH_LOCK, "1\n", "utf8");
    }
  });

  afterAll(async () => {
    if (hadOriginalLock) {
      await writeFile(KUMA_MODE_LOCK, originalLockContents);
    } else if (existsSync(KUMA_MODE_LOCK)) {
      await unlink(KUMA_MODE_LOCK);
    }

    if (hadOriginalDispatchLock) {
      await writeFile(KUMA_DISPATCH_LOCK, originalDispatchLockContents);
    } else if (existsSync(KUMA_DISPATCH_LOCK)) {
      await unlink(KUMA_DISPATCH_LOCK);
    }
  });

  it("prints the cmux browser block reason to stderr", async () => {
    const result = await runGuard("cmux browser --help");

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cmux browser 사용 금지");
  });

  it("blocks raw cmux send and points callers to the wrapper", async () => {
    const result = await runGuard("cmux send --surface surface:7 hello");

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("raw cmux send/send-key 사용 금지");
    expect(result.stderr).toContain("kuma-cmux-send.sh");
  });

  it("allows the kuma-cmux-send.sh wrapper command", async () => {
    const result = await runGuard("~/.kuma/cmux/kuma-cmux-send.sh surface:7 \"hello\"");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"continue": true');
    expect(result.stderr).toBe("");
  });

  it("allows the kuma-task CLI wrapper command", async () => {
    const result = await runGuard("~/.kuma/bin/kuma-task --help");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"continue": true');
    expect(result.stderr).toBe("");
  });

  it("prints the generic block reason to stderr", async () => {
    const result = await runGuard("touch /tmp/x");

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("쿠마는 이 명령 직접 실행 금지");
  });
});
