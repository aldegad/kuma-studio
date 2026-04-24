import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readProjectsRegistry } from "./project-defaults.mjs";
import { buildProjectWorktreeIndex, isWithinRoot, resolveMaybeRealPath } from "./git-worktrees.mjs";

const POLLING_INTERVAL_MS = 5 * 60 * 1000;
const GIT_ACTIVITY_COMMIT_LIMIT = 200;
const GIT_LOG_FORMAT = "%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%P%x1f%D%x1e";

let pollingInterval = null;
let gitActivityCache = createEmptySnapshot(resolveWorkspace());
const refreshListeners = new Set();

function resolveWorkspace() {
  const configuredWorkspace = process.env.KUMA_STUDIO_WORKSPACE?.trim();
  if (configuredWorkspace) {
    return configuredWorkspace;
  }

  return process.cwd();
}

function createEmptySnapshot(workspace) {
  return {
    lastUpdated: new Date().toISOString(),
    workspace,
    repos: [],
    totalCommitsToday: 0,
    totalMergeCommitsToday: 0,
  };
}

function findGitRepos(scanRoots) {
  const repos = new Set();

  function walk(currentPath, depth) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const hasGitDir = entries.some((entry) => entry.name === ".git");
    if (hasGitDir) {
      repos.add(currentPath);
      return;
    }

    if (depth >= 3) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === "node_modules") {
        continue;
      }

      walk(path.join(currentPath, entry.name), depth + 1);
    }
  }

  for (const root of scanRoots) {
    walk(root, 0);
  }

  return Array.from(repos).sort((left, right) => left.localeCompare(right));
}

function execGit(repoPath, args, timeout = 5000) {
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function readBranch(repoPath) {
  const branch = execGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch || null;
}

function readBranchStatus(repoPath) {
  const upstream = execGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream) {
    return {
      upstream: null,
      ahead: 0,
      behind: 0,
      state: "no-upstream",
    };
  }

  const counts = execGit(repoPath, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
  const [aheadRaw = "0", behindRaw = "0"] = counts?.split(/\s+/u) ?? [];
  const ahead = Number.parseInt(aheadRaw, 10);
  const behind = Number.parseInt(behindRaw, 10);
  const normalizedAhead = Number.isFinite(ahead) ? ahead : 0;
  const normalizedBehind = Number.isFinite(behind) ? behind : 0;
  const state =
    normalizedAhead > 0 && normalizedBehind > 0
      ? "diverged"
      : normalizedAhead > 0
        ? "ahead"
        : normalizedBehind > 0
          ? "behind"
          : "clean";

  return {
    upstream,
    ahead: normalizedAhead,
    behind: normalizedBehind,
    state,
  };
}

function readRevisionCount(repoPath, args = [], revision = "HEAD") {
  const output = execGit(repoPath, ["rev-list", "--count", ...args, revision], 10_000);
  const count = Number.parseInt(output ?? "0", 10);
  return Number.isFinite(count) ? count : 0;
}

function readCommits(repoPath, { maxCount = GIT_ACTIVITY_COMMIT_LIMIT } = {}) {
  try {
    const args = ["log", "--all", "--topo-order", "--date=iso-strict", `--format=${GIT_LOG_FORMAT}`];
    if (Number.isFinite(maxCount) && maxCount > 0) {
      args.push(`--max-count=${Math.floor(maxCount)}`);
    }

    const raw = execFileSync(
      "git",
      args,
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    return raw
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [
          hash = "",
          shortHash = "",
          message = "",
          author = "",
          timestamp = "",
          parentsRaw = "",
          refsRaw = "",
        ] = record.split("\x1f");
        const parents = parentsRaw.split(/\s+/u).map((parent) => parent.trim()).filter(Boolean);
        const refs = refsRaw.split(",").map((ref) => ref.trim()).filter(Boolean);

        return {
          hash,
          shortHash,
          message,
          author,
          timestamp,
          parents,
          parentCount: parents.length,
          isMerge: parents.length > 1,
          refs,
        };
      });
  } catch {
    return [];
  }
}

function resolveWorktreeForRepo(repoPath, worktreeIndex) {
  const resolvedRepoPath = resolveMaybeRealPath(repoPath);
  let bestMatch = null;

  for (const worktree of worktreeIndex.byPath.values()) {
    if (!isWithinRoot(worktree.path, resolvedRepoPath)) {
      continue;
    }

    if (!bestMatch || worktree.path.length > bestMatch.path.length) {
      bestMatch = worktree;
    }
  }

  return bestMatch;
}

function resolveProjectForRepo(repoPath, projectRoots, worktreeIndex) {
  const resolvedRepoPath = resolveMaybeRealPath(repoPath);
  const worktree = resolveWorktreeForRepo(repoPath, worktreeIndex);
  if (worktree) {
    return { id: worktree.projectId, path: worktree.path, worktree };
  }

  let bestMatch = null;

  for (const [projectId, projectRoot] of Object.entries(projectRoots)) {
    const resolvedProjectRoot = resolveMaybeRealPath(projectRoot);
    if (!isWithinRoot(resolvedProjectRoot, resolvedRepoPath)) {
      continue;
    }

    if (!bestMatch || resolvedProjectRoot.length > bestMatch.path.length) {
      bestMatch = { id: projectId, path: resolvedProjectRoot };
    }
  }

  return bestMatch;
}

function buildRepoActivity(repoPath, projectRoots, worktreeIndex) {
  const commits = readCommits(repoPath);
  const commitCount = readRevisionCount(repoPath, [], "--all");
  const mergeCommitCount = readRevisionCount(repoPath, ["--merges"], "--all");
  const commitsToday = readRevisionCount(repoPath, ["--since=midnight"], "--all");
  const mergeCommitsToday = readRevisionCount(repoPath, ["--since=midnight", "--merges"], "--all");
  const project = resolveProjectForRepo(repoPath, projectRoots, worktreeIndex);
  const worktree = project?.worktree ?? resolveWorktreeForRepo(repoPath, worktreeIndex);

  return {
    name: path.basename(repoPath),
    path: repoPath,
    projectId: project?.id ?? null,
    projectName: project?.id ?? null,
    worktreePath: worktree?.path ?? null,
    worktreeName: worktree?.name ?? null,
    worktreeBranch: worktree?.branch ?? null,
    worktreeHead: worktree?.head ?? null,
    isWorktree: Boolean(worktree && !worktree.isMain),
    isMainWorktree: worktree?.isMain ?? null,
    branch: readBranch(repoPath),
    branchStatus: readBranchStatus(repoPath),
    commitCount,
    mergeCommitCount,
    commitsToday,
    mergeCommitsToday,
    commits,
  };
}

function refreshGitActivity() {
  const workspace = resolveWorkspace();
  const projectRoots = readProjectsRegistry();
  const worktreeIndex = buildProjectWorktreeIndex(projectRoots);
  const scanRoots = [...new Set([
    workspace,
    ...Object.values(projectRoots),
    ...worktreeIndex.worktreeRoots,
  ].map(resolveMaybeRealPath))];
  const repos = findGitRepos(scanRoots).map((repoPath) => buildRepoActivity(repoPath, projectRoots, worktreeIndex));
  const activity = {
    lastUpdated: new Date().toISOString(),
    workspace,
    repos,
    projectWorktrees: worktreeIndex.byProjectId,
    totalCommitsToday: repos.reduce((total, repo) => total + (repo.commitsToday ?? 0), 0),
    totalMergeCommitsToday: repos.reduce((total, repo) => total + repo.mergeCommitsToday, 0),
  };

  gitActivityCache = activity;

  for (const listener of refreshListeners) {
    try {
      listener(activity);
    } catch {
      // Ignore listener failures so polling continues for future updates.
    }
  }

  return activity;
}

export function getGitActivity() {
  return gitActivityCache;
}

export function startGitActivityPolling(onRefresh) {
  if (typeof onRefresh === "function") {
    refreshListeners.add(onRefresh);
  }

  const activity = refreshGitActivity();

  if (pollingInterval == null) {
    pollingInterval = setInterval(() => {
      refreshGitActivity();
    }, POLLING_INTERVAL_MS);
    pollingInterval.unref?.();
  }

  return activity;
}

export function stopGitActivityPolling() {
  refreshListeners.clear();

  if (pollingInterval != null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
