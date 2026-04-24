import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT_PATH = resolve(process.cwd(), "scripts/hooks/grep-bre-guard.sh");

async function runGuard(command) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn("bash", [SCRIPT_PATH], {
      env: process.env,
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

describe("grep-bre-guard", () => {
  it("blocks grep with backslash-pipe alternation", async () => {
    const result = await runGuard('grep "foo\\|bar" README.md');

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("backslash-pipe");
  });

  it("blocks rg with backslash-pipe alternation", async () => {
    const result = await runGuard('rg "foo\\|bar" .');

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("backslash-pipe");
  });

  it("allows grep -E with plain alternation", async () => {
    const result = await runGuard('grep -E "foo|bar" README.md');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"continue": true');
    expect(result.stderr).toBe("");
  });

  it("allows rg with plain alternation", async () => {
    const result = await runGuard('rg "foo|bar" .');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"continue": true');
    expect(result.stderr).toBe("");
  });
});
