import { useState } from "react";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import type { GitActivityBranchStatus, GitActivityRepo } from "../../types/stats";

interface GitLogPanelProps {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeWorktreePath?: string | null;
  activeWorktreeName?: string | null;
}

const BRANCH_STATE_LABELS: Record<GitActivityBranchStatus["state"], string> = {
  clean: "동기화",
  ahead: "push 대기",
  behind: "pull 필요",
  diverged: "분기됨",
  "no-upstream": "추적 없음",
};

const BRANCH_STATE_COLORS: Record<GitActivityBranchStatus["state"], string> = {
  clean: "#16a34a",
  ahead: "#2563eb",
  behind: "#d97706",
  diverged: "#dc2626",
  "no-upstream": "var(--t-faint)",
};

function formatCommitTime(timestamp: string) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "--:--";
  }

  return value.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBranchStatus(status: GitActivityBranchStatus | undefined) {
  if (!status) {
    return "추적 없음";
  }

  const deltas = [
    status.ahead > 0 ? `+${status.ahead}` : null,
    status.behind > 0 ? `-${status.behind}` : null,
  ].filter(Boolean);
  const deltaText = deltas.length > 0 ? ` ${deltas.join(" ")}` : "";
  return `${BRANCH_STATE_LABELS[status.state]}${deltaText}`;
}

function getRepoDisplayName(repo: GitActivityRepo, showProjectName: boolean) {
  if (showProjectName && repo.projectName && repo.projectName !== repo.name) {
    return `${repo.projectName} / ${repo.name}`;
  }

  return repo.name;
}

export function GitLogPanel({
  activeProjectId,
  activeProjectName,
  activeWorktreePath = null,
  activeWorktreeName = null,
}: GitLogPanelProps) {
  const gitActivity = useDashboardStore((state) => state.gitActivity);
  const [collapsed, setCollapsed] = useState(true);
  const scopedRepos = activeProjectId
    ? gitActivity.repos.filter((repo) =>
        repo.projectId === activeProjectId && (!activeWorktreePath || repo.worktreePath === activeWorktreePath),
      )
    : gitActivity.repos;
  const reposWithCommits = scopedRepos.filter((repo) => repo.commits.length > 0);
  const scopedCommitCount = scopedRepos.reduce((total, repo) => total + repo.commits.length, 0);
  const scopedMergeCount = scopedRepos.reduce((total, repo) => total + (repo.mergeCommitsToday ?? 0), 0);
  const branchRepos = scopedRepos.filter((repo) => repo.branch || repo.branchStatus);
  const scopeLabel = activeWorktreeName
    ? `${activeProjectName ?? activeProjectId ?? "프로젝트"} · ${activeWorktreeName}`
    : activeProjectName ?? "전체";
  const showProjectName = activeProjectId == null;

  return (
    <div
      className="rounded-2xl backdrop-blur-md border shadow-lg overflow-hidden"
      style={{ background: "var(--panel-bg)", borderColor: "var(--panel-border)" }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
            커밋 로그 ({scopedCommitCount}건)
          </span>
          <span className="block truncate text-[9px]" style={{ color: "var(--t-faint)" }}>
            {scopeLabel}
            {scopedMergeCount > 0 ? ` · merge ${scopedMergeCount}` : ""}
          </span>
        </span>
        <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 max-h-60 overflow-y-auto">
          {branchRepos.length > 0 && (
            <div className="space-y-1">
              {branchRepos.map((repo) => (
                <div
                  key={`branch:${repo.path}`}
                  className="rounded-lg px-2 py-1.5"
                  style={{ background: "var(--panel-hover)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-semibold" style={{ color: "var(--t-primary)" }}>
                      {getRepoDisplayName(repo, showProjectName)}
                    </span>
                    <span className="shrink-0 font-mono text-[9px]" style={{ color: "var(--t-muted)" }}>
                      {repo.branch ?? "detached"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px]">
                    <span className="truncate" style={{ color: "var(--t-faint)" }}>
                      {repo.branchStatus?.upstream ?? "upstream 없음"}
                    </span>
                    <span
                      className="shrink-0 font-semibold"
                      style={{ color: repo.branchStatus ? BRANCH_STATE_COLORS[repo.branchStatus.state] : "var(--t-faint)" }}
                    >
                      {formatBranchStatus(repo.branchStatus)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {reposWithCommits.length > 0 ? reposWithCommits.map((repo) => (
              <div key={repo.path} className="space-y-1">
                {repo.commits.map((commit) => (
                  <div key={`${repo.path}:${commit.hash}`} className="flex items-start gap-2">
                    <p className="min-w-0 text-[10px] leading-tight" style={{ color: "var(--t-secondary)" }}>
                      <span className="font-semibold" style={{ color: "var(--t-primary)" }}>
                        {getRepoDisplayName(repo, showProjectName)}
                      </span>
                      {commit.isMerge && (
                        <>
                          <span style={{ color: "var(--t-faint)" }}> | </span>
                          <span className="font-semibold" style={{ color: "#d97706" }}>merge</span>
                        </>
                      )}
                      <span style={{ color: "var(--t-faint)" }}> | </span>
                      <span>{commit.message}</span>
                      <span style={{ color: "var(--t-faint)" }}> | </span>
                      <span style={{ color: "var(--t-muted)" }}>
                        {formatCommitTime(commit.timestamp)}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            )) : (
              <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                오늘 기록된 커밋이 없습니다.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
