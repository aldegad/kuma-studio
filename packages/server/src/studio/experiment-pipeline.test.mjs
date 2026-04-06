import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, assert, describe, it } from "vitest";

import { createExperimentPipeline } from "./experiment-pipeline.mjs";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

describe("experiment-pipeline", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("creates and cleans up a git worktree", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "kuma-exp-pipeline-"));
    tempDirs.push(repoRoot);

    run("git", ["init", "-b", "main"], { cwd: repoRoot });
    run("git", ["config", "user.name", "Kuma Test"], { cwd: repoRoot });
    run("git", ["config", "user.email", "kuma@example.com"], { cwd: repoRoot });
    writeFileSync(resolve(repoRoot, "README.md"), "# test\n", "utf8");
    run("git", ["add", "README.md"], { cwd: repoRoot });
    run("git", ["commit", "-m", "init"], { cwd: repoRoot });

    const pipeline = createExperimentPipeline(repoRoot, run);
    const started = pipeline.start({
      id: "exp-1234",
      title: "AI trend experiment",
      branch: null,
      worktree: null,
    });

    assert.ok(started.branch?.startsWith("exp/"));
    assert.ok(started.worktree);
    assert.strictEqual(run("git", ["-C", started.worktree, "rev-parse", "--abbrev-ref", "HEAD"]), started.branch);

    const cleaned = pipeline.cleanup(started);
    assert.strictEqual(cleaned.branch, null);
    assert.strictEqual(cleaned.worktree, null);
  });
});
