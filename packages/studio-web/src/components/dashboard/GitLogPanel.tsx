import { useState } from "react";
import { useDashboardStore } from "../../stores/use-dashboard-store";

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

export function GitLogPanel() {
  const gitActivity = useDashboardStore((state) => state.gitActivity);
  const [collapsed, setCollapsed] = useState(true);
  const reposWithCommits = gitActivity.repos.filter((repo) => repo.commits.length > 0);

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
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
          커밋 로그 ({gitActivity.totalCommitsToday}건)
        </span>
        <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-1 max-h-36 overflow-y-auto">
          {reposWithCommits.length > 0 ? reposWithCommits.map((repo) => (
            <div key={repo.path} className="space-y-1">
              {repo.commits.map((commit) => (
                <div key={`${repo.path}:${commit.hash}`} className="flex items-start gap-2">
                  <p className="text-[10px] leading-tight" style={{ color: "var(--t-secondary)" }}>
                    <span className="font-semibold" style={{ color: "var(--t-primary)" }}>
                      {repo.name}
                    </span>
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
      )}
    </div>
  );
}
