import { useState } from "react";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import type { GitActivityBranchStatus, GitActivityCommit, GitActivityRepo } from "../../types/stats";

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

function isSameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatCommitTimestamp(timestamp: string) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "--";
  }

  const time = value.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isSameLocalDay(value, new Date())) {
    return time;
  }

  return `${value.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} ${time}`;
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

function formatRefLabel(ref: string) {
  return ref.replace(/^HEAD -> /u, "").replace(/^tag: /u, "#");
}

function getParentLabel(commit: GitActivityCommit) {
  const parentCount = commit.parentCount ?? commit.parents?.length ?? 0;
  if (parentCount === 0) {
    return "root";
  }
  if (parentCount > 1) {
    return `${parentCount} parents`;
  }
  return null;
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
  const scopedCommitCount = scopedRepos.reduce((total, repo) => total + (repo.commitCount ?? repo.commits.length), 0);
  const visibleCommitCount = scopedRepos.reduce((total, repo) => total + repo.commits.length, 0);
  const scopedTodayCount = scopedRepos.reduce((total, repo) => total + (repo.commitsToday ?? 0), 0);
  const scopedMergeCount = scopedRepos.reduce((total, repo) => total + (repo.mergeCommitCount ?? repo.mergeCommitsToday ?? 0), 0);
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
            {visibleCommitCount > 0 ? ` · 최근 ${visibleCommitCount}개` : ""}
            {scopedTodayCount > 0 ? ` · 오늘 ${scopedTodayCount}개` : ""}
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
                  <div className="mt-1 flex items-center gap-2 text-[8px] font-mono" style={{ color: "var(--t-faint)" }}>
                    <span>{repo.commitCount ?? repo.commits.length} commits</span>
                    {((repo.mergeCommitCount ?? repo.mergeCommitsToday) ?? 0) > 0 && (
                      <span>{repo.mergeCommitCount ?? repo.mergeCommitsToday} merges</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {reposWithCommits.length > 0 ? reposWithCommits.map((repo) => (
              <div key={repo.path} className="space-y-1">
                {repo.commits.map((commit) => (
                  <div
                    key={`${repo.path}:${commit.hash}`}
                    className="rounded-md px-2 py-1.5"
                    style={{ background: "rgba(255,255,255,0.035)" }}
                    title={commit.hash}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-[1px] w-12 shrink-0 font-mono text-[9px]" style={{ color: "var(--t-muted)" }}>
                        {commit.shortHash ?? commit.hash.slice(0, 7)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-medium leading-tight" style={{ color: "var(--t-secondary)" }}>
                          {commit.message}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[8px]" style={{ color: "var(--t-faint)" }}>
                          <span className="font-semibold" style={{ color: "var(--t-muted)" }}>
                            {getRepoDisplayName(repo, showProjectName)}
                          </span>
                          {commit.isMerge && (
                            <span className="font-semibold" style={{ color: "#d97706" }}>merge</span>
                          )}
                          {getParentLabel(commit) && (
                            <span>{getParentLabel(commit)}</span>
                          )}
                          {(commit.refs ?? []).slice(0, 3).map((ref) => (
                            <span key={ref} className="rounded-full px-1" style={{ background: "rgba(245,158,11,0.10)", color: "#b45309" }}>
                              {formatRefLabel(ref)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="shrink-0 text-[9px]" style={{ color: "var(--t-muted)" }}>
                        {formatCommitTimestamp(commit.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )) : (
              <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                표시할 커밋이 없습니다.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
