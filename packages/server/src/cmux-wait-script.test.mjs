import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

describe("cmux wait script (liveness-only)", { timeout: 30000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("waits for the exact fresh signal file and ignores stale or similar matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const signalDir = join(root, "signals");
    const signalName = "kuma-studio-howl-20260410-164947-done";
    const similarSignalName = "kuma-studio-howl-20260410-164423-done";

    await mkdir(signalDir, { recursive: true });

    await writeFile(join(signalDir, similarSignalName), "done\n", "utf8");
    await writeFile(join(signalDir, signalName), "stale\n", "utf8");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));

    const child = spawn("bash", [WAIT_SCRIPT_PATH, signalName, "--timeout", "4"], {
      env: {
        ...process.env,
        KUMA_SIGNAL_DIR: signalDir,
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

    await writeFile(join(signalDir, signalName), "done\n", "utf8");

    const exitCode = await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", resolvePromise);
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
    expect(stderr).toBe("");
  });

  it("rejects bare numeric positional timeout values instead of silently treating them as result files", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const signalDir = join(root, "signals");
    await mkdir(signalDir, { recursive: true });

    await expect(execFile("bash", [WAIT_SCRIPT_PATH, "demo-signal", "300"], {
      env: {
        ...process.env,
        KUMA_SIGNAL_DIR: signalDir,
      },
    })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Use --timeout 300 explicitly"),
    });
  });

  it("prints a RESULT_FILE pointer when one is provided and the signal arrives", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const signalDir = join(root, "signals");
    const resultPath = join(root, "some.result.md");
    const signalName = "kuma-studio-demo-done";

    await mkdir(signalDir, { recursive: true });
    await writeFile(resultPath, "# ignored body\n", "utf8");

    const child = spawn("bash", [WAIT_SCRIPT_PATH, signalName, resultPath, "--timeout", "4"], {
      env: {
        ...process.env,
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_WAIT_POLL_INTERVAL: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });

    // Give wait.sh enough time to initialize its reference timestamp before
    // we create the signal file. Otherwise the signal mtime can fall before
    // the reference and be treated as stale under parallel test load.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
    await writeFile(join(signalDir, signalName), "done\n", "utf8");

    const exitCode = await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", resolvePromise);
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
    expect(stdout).toContain(`RESULT_FILE: ${resultPath}`);
    expect(stdout).not.toContain("# ignored body");
  });

  it("returns worker-down when the surface snapshot cannot be classified", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const signalDir = join(root, "signals");
    const signalName = "kuma-studio-dead-done";

    await mkdir(binDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
case "$1" in
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

    await expect(execFile("bash", [WAIT_SCRIPT_PATH, signalName, "--surface", "surface:18", "--timeout", "1"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_WAIT_POLL_INTERVAL: "1",
      },
    })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("WORKER_DOWN"),
    });
  });

  it("returns worker-idle when the surface snapshot shows prompt plus bypass footer", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const signalDir = join(root, "signals");
    const signalName = "kuma-studio-idle-footer-done";

    await mkdir(binDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
case "$1" in
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

    await expect(execFile("bash", [WAIT_SCRIPT_PATH, signalName, "--surface", "surface:18", "--timeout", "1"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SIGNAL_DIR: signalDir,
        KUMA_WAIT_POLL_INTERVAL: "1",
      },
    })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("WORKER_IDLE_NO_SIGNAL"),
    });
  });

  it("keeps waiting while the surface is still working and eventually receives the signal", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-wait-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const signalDir = join(root, "signals");
    const signalName = "kuma-studio-working-done";

    await mkdir(binDir, { recursive: true });
    await mkdir(signalDir, { recursive: true });

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
case "$1" in
  tree)
    printf 'workspace:1\\n  surface:18\\n'
    ;;
  read-screen)
    # Simulate a working surface: spinner with esc token indicating progress.
    printf '✶ Generating... (tokens ↑ 1.2k)\\n  esc to interrupt\\n'
    ;;
  *)
    exit 0
    ;;
esac
`,
    );

    const child = spawn(
      "bash",
      [WAIT_SCRIPT_PATH, signalName, "--surface", "surface:18", "--timeout", "1"],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          KUMA_SIGNAL_DIR: signalDir,
          KUMA_WAIT_POLL_INTERVAL: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    const deadline = Date.now() + 5000;
    while (!stderr.includes("SIGNAL_TIMEOUT_CONTINUE") && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }

    expect(child.exitCode).toBeNull();
    expect(stderr).toContain("SIGNAL_TIMEOUT_CONTINUE");

    await writeFile(join(signalDir, signalName), "done\n", "utf8");

    const exitCode = await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", resolvePromise);
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`SIGNAL_RECEIVED: ${signalName}`);
  });
});
