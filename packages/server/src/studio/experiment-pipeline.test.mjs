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

describe("experiment-pipeline", { timeout: 30_000 }, () => {
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

  it("embeds result summary and source links into the draft PR body", () => {
    const calls = [];
    const execFn = (command, args) => {
      calls.push({ command, args });

      if (command === "git" && args[0] === "symbolic-ref") {
        return "refs/remotes/origin/main";
      }

      if (command === "gh") {
        return "https://github.com/example/repo/pull/99";
      }

      return "";
    };

    const pipeline = createExperimentPipeline("/tmp/kuma-exp-pipeline", execFn);
    const finalized = pipeline.finalize(
      {
        id: "exp-5678",
        title: "Agent SDK rollout",
        source: "ai-trend",
        branch: "exp/agent-sdk-rollout",
        worktree: "/tmp/worktree-agent-sdk",
        pr_url: null,
        researchQuestion: "이 SDK를 자동화 워크플로에 바로 붙일 수 있을까?",
        resultSummary: "실험 결과 workflow orchestration path를 바로 연결할 수 있었다.",
      },
      {
        sourceTrend: {
          title: "OpenAI Agent SDK ships",
          articleUrl: "https://example.com/agent-sdk",
          feedUrl: "https://example.com/feed.xml",
        },
      },
    );

    assert.strictEqual(finalized.pr_url, "https://github.com/example/repo/pull/99");
    assert.include(finalized.thread_draft, "실험 결과 workflow orchestration path를 바로 연결할 수 있었다.");
    assert.include(finalized.thread_draft, "https://example.com/agent-sdk");

    const ghCall = calls.find((entry) => entry.command === "gh");
    const bodyIndex = ghCall.args.indexOf("--body");
    assert.ok(bodyIndex >= 0);
    assert.include(ghCall.args[bodyIndex + 1], "## Result Summary");
    assert.include(ghCall.args[bodyIndex + 1], "https://example.com/agent-sdk");
  });
});
