import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

import { resolveProjectStateDir } from "../state-home.mjs";

function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function slugify(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);

  return slug || "experiment";
}

function resolveDefaultBranch(root, execFn = runCommand) {
  try {
    const remoteHead = execFn("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: root });
    return remoteHead.split("/").at(-1) ?? "main";
  } catch {
    try {
      return execFn("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }) || "main";
    } catch {
      return "main";
    }
  }
}

function buildWorktreePath(root, branch) {
  const stateDir = resolveProjectStateDir(root);
  return resolve(stateDir, "experiments", "worktrees", branch.replace(/[\\/]/gu, "--"));
}

function buildThreadDraft(experiment) {
  return [
    `1/ ${experiment.title}`,
    "",
    `- 출처: ${experiment.source}`,
    `- 브랜치: ${experiment.branch ?? "미생성"}`,
    `- 워크트리: ${experiment.worktree ? basename(experiment.worktree) : "미생성"}`,
    experiment.pr_url ? `- PR: ${experiment.pr_url}` : "- PR: 생성 예정",
    "",
    "이번 실험에서 무엇을 시도했고, 무엇이 좋아졌는지 요약해서 이어쓰기",
    "- 적용 배경",
    "- 구현 포인트",
    "- 결과와 다음 단계",
  ].join("\n");
}

export function createExperimentPipeline(root, execFn = runCommand) {
  const repoRoot = resolve(root);

  return {
    start(experiment) {
      const baseBranch = resolveDefaultBranch(repoRoot, execFn);
      const branch = experiment.branch ?? `exp/${slugify(experiment.title)}-${experiment.id.slice(-4)}`;
      const worktree = experiment.worktree ?? buildWorktreePath(repoRoot, branch);

      if (!existsSync(worktree)) {
        execFn("git", ["worktree", "add", "-b", branch, worktree, baseBranch], { cwd: repoRoot });
      }

      return { branch, worktree };
    },

    finalize(experiment) {
      const thread_draft = buildThreadDraft(experiment);
      let pr_url = experiment.pr_url ?? null;

      if (experiment.branch && experiment.worktree && !pr_url) {
        try {
          execFn("git", ["-C", experiment.worktree, "push", "-u", "origin", experiment.branch], { cwd: repoRoot });
          pr_url = execFn(
            "gh",
            [
              "pr",
              "create",
              "--draft",
              "--head",
              experiment.branch,
              "--base",
              resolveDefaultBranch(repoRoot, execFn),
              "--title",
              experiment.title,
              "--body",
              thread_draft,
            ],
            { cwd: repoRoot },
          );
        } catch {
          pr_url = null;
        }
      }

      return { pr_url, thread_draft };
    },

    cleanup(experiment) {
      if (experiment.worktree && existsSync(experiment.worktree)) {
        try {
          execFn("git", ["worktree", "remove", "--force", experiment.worktree], { cwd: repoRoot });
        } catch {
          // Best effort cleanup.
        }
      }

      if (experiment.branch) {
        try {
          execFn("git", ["branch", "-D", experiment.branch], { cwd: repoRoot });
        } catch {
          // Best effort cleanup.
        }
      }

      return { branch: null, worktree: null };
    },
  };
}
