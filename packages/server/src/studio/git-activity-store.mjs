import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const POLLING_INTERVAL_MS = 5 * 60 * 1000;
const GIT_LOG_FORMAT = "%H%x1f%s%x1f%an%x1f%cI%x1e";

let pollingInterval = null;
let gitActivityCache = createEmptySnapshot(resolveWorkspace());
const refreshListeners = new Set();

function resolveWorkspace() {
  const configuredWorkspace = process.env.KUMA_STUDIO_WORKSPACE?.trim();
  if (configuredWorkspace) {
    return configuredWorkspace;
  }

  return path.join(os.homedir(), "Documents/workspace");
}

function createEmptySnapshot(workspace) {
  return {
    lastUpdated: new Date().toISOString(),
    workspace,
    repos: [],
    totalCommitsToday: 0,
  };
}

function findGitRepos(workspace) {
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

  walk(workspace, 0);
  return Array.from(repos).sort((left, right) => left.localeCompare(right));
}

function readBranch(repoPath) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function readCommits(repoPath) {
  try {
    const raw = execFileSync(
      "git",
      ["log", "--since=midnight", "--date=iso-strict", `--format=${GIT_LOG_FORMAT}`],
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
      },
    );

    return raw
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash = "", message = "", author = "", timestamp = ""] = record.split("\x1f");
        return { hash, message, author, timestamp };
      });
  } catch {
    return [];
  }
}

function buildRepoActivity(repoPath) {
  return {
    name: path.basename(repoPath),
    path: repoPath,
    branch: readBranch(repoPath),
    commits: readCommits(repoPath),
  };
}

function refreshGitActivity() {
  const workspace = resolveWorkspace();
  const repos = findGitRepos(workspace).map((repoPath) => buildRepoActivity(repoPath));
  const activity = {
    lastUpdated: new Date().toISOString(),
    workspace,
    repos,
    totalCommitsToday: repos.reduce((total, repo) => total + repo.commits.length, 0),
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
