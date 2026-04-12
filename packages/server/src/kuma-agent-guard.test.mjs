import { existsSync, readFileSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const KUMA_MODE_LOCK = "/tmp/kuma-mode-agent-guard-vitest.lock";
const SPAWN_ALLOW_GLOB = "/tmp/kuma-agent-spawn-allow-vitest-*";
const SPAWN_ALLOW_PATH = "/tmp/kuma-agent-spawn-allow-vitest-main";
const SCRIPT_PATH = resolve(process.cwd(), "scripts/hooks/kuma-agent-guard.sh");

let hadOriginalLock = false;
let originalLockContents = null;

async function runGuard(env = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn("bash", [SCRIPT_PATH], {
      env: {
        ...process.env,
        KUMA_ROLE: "master",
        KUMA_MODE_LOCK_PATH: KUMA_MODE_LOCK,
        KUMA_AGENT_SPAWN_ALLOW_GLOB: SPAWN_ALLOW_GLOB,
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

    child.stdin.end("{}");
  });
}

describe.sequential("kuma-agent-guard", () => {
  beforeAll(async () => {
    hadOriginalLock = existsSync(KUMA_MODE_LOCK);
    originalLockContents = hadOriginalLock ? readFileSync(KUMA_MODE_LOCK) : null;
    if (!hadOriginalLock) {
      await writeFile(KUMA_MODE_LOCK, "1\n", "utf8");
    }

    if (existsSync(SPAWN_ALLOW_PATH)) {
      await unlink(SPAWN_ALLOW_PATH);
    }
  });

  afterAll(async () => {
    if (hadOriginalLock) {
      await writeFile(KUMA_MODE_LOCK, originalLockContents);
    } else if (existsSync(KUMA_MODE_LOCK)) {
      await unlink(KUMA_MODE_LOCK);
    }

    if (existsSync(SPAWN_ALLOW_PATH)) {
      await unlink(SPAWN_ALLOW_PATH);
    }
  });

  it("blocks direct Agent usage without a scoped allow", async () => {
    const result = await runGuard();

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("scoped spawn allow");
  });

  it("allows workers without a scoped allow", async () => {
    const result = await runGuard({ KUMA_ROLE: "worker" });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"continue": true');
    expect(result.stderr).toBe("");
  });

  it("consumes a fresh scoped allow exactly once", async () => {
    await writeFile(SPAWN_ALLOW_PATH, "kind: kuma-agent-spawn-allow\n", "utf8");

    const first = await runGuard();
    const second = await runGuard();

    expect(first.code).toBe(0);
    expect(first.stdout).toContain('"continue": true');
    expect(first.stderr).toBe("");
    expect(existsSync(SPAWN_ALLOW_PATH)).toBe(false);

    expect(second.code).toBe(2);
    expect(second.stdout).toBe("");
    expect(second.stderr).toContain("scoped spawn allow");
  });

  it("deletes expired scoped allow files instead of consuming them", async () => {
    await writeFile(SPAWN_ALLOW_PATH, "kind: kuma-agent-spawn-allow\n", "utf8");

    const result = await runGuard({ KUMA_AGENT_SPAWN_ALLOW_TTL_SECONDS: "0" });

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("scoped spawn allow");
    expect(existsSync(SPAWN_ALLOW_PATH)).toBe(false);
  });
});
