import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function resolveMaybeRealPath(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  try {
    return fs.realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function isWithinRoot(root, candidatePath) {
  return candidatePath === root || candidatePath.startsWith(`${root}${path.sep}`);
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

function normalizeBranchName(refName) {
  if (typeof refName !== "string" || !refName) {
    return null;
  }

  return refName.replace(/^refs\/heads\//u, "");
}

function parseWorktreePorcelain(raw) {
  const worktrees = [];
  let current = null;

  const pushCurrent = () => {
    if (current?.path) {
      worktrees.push({
        ...current,
        path: resolveMaybeRealPath(current.path),
        branch: normalizeBranchName(current.branch),
      });
    }
    current = null;
  };

  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) {
      pushCurrent();
      continue;
    }

    const firstSpace = line.indexOf(" ");
    const key = firstSpace === -1 ? line : line.slice(0, firstSpace);
    const value = firstSpace === -1 ? true : line.slice(firstSpace + 1);

    if (key === "worktree") {
      pushCurrent();
      current = {
        path: String(value),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === "HEAD") {
      current.head = String(value);
    } else if (key === "branch") {
      current.branch = String(value);
    } else if (key === "detached") {
      current.detached = true;
    } else if (key === "bare") {
      current.bare = true;
    } else if (key === "locked") {
      current.locked = true;
    } else if (key === "prunable") {
      current.prunable = true;
    }
  }

  pushCurrent();
  return worktrees;
}

export function readGitWorktrees(repoPath) {
  const resolvedRepoPath = resolveMaybeRealPath(repoPath);
  const raw = execGit(resolvedRepoPath, ["worktree", "list", "--porcelain"]);
  if (!raw) {
    return [];
  }

  return parseWorktreePorcelain(raw);
}

export function buildProjectWorktreeIndex(projectRoots) {
  const byProjectId = {};
  const byPath = new Map();

  for (const [projectId, projectRoot] of Object.entries(projectRoots)) {
    const resolvedProjectRoot = resolveMaybeRealPath(projectRoot);
    const worktrees = readGitWorktrees(resolvedProjectRoot).map((worktree) => ({
      ...worktree,
      projectId,
      isMain: worktree.path === resolvedProjectRoot,
      name: path.basename(worktree.path),
    }));

    if (worktrees.length === 0) {
      continue;
    }

    const deduped = [];
    const seenPaths = new Set();
    for (const worktree of worktrees) {
      if (seenPaths.has(worktree.path)) {
        continue;
      }
      seenPaths.add(worktree.path);
      deduped.push(worktree);
      byPath.set(worktree.path, worktree);
    }

    byProjectId[projectId] = deduped.sort((left, right) => {
      if (left.isMain !== right.isMain) {
        return left.isMain ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });
  }

  return {
    byProjectId,
    byPath,
    worktreeRoots: Array.from(byPath.keys()).sort((left, right) => left.localeCompare(right)),
  };
}
