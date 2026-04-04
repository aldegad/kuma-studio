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

export function GitLogPanel({ isNight }: { isNight: boolean }) {
  const gitActivity = useDashboardStore((state) => state.gitActivity);
  const [collapsed, setCollapsed] = useState(true);
  const reposWithCommits = gitActivity.repos.filter((repo) => repo.commits.length > 0);

  return (
    <div className={`rounded-2xl backdrop-blur-md border shadow-lg overflow-hidden ${
      isNight ? "bg-indigo-950/70 border-indigo-800/40" : "bg-white/75 border-white/50"
    }`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-stone-50/30 transition-colors"
      >
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isNight ? "text-indigo-400" : "text-stone-500"}`}>
          커밋 로그 ({gitActivity.totalCommitsToday}건)
        </span>
        <span className={`text-[10px] ${isNight ? "text-indigo-500" : "text-stone-400"}`}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-1 max-h-36 overflow-y-auto">
          {reposWithCommits.length > 0 ? reposWithCommits.map((repo) => (
            <div key={repo.path} className="space-y-1">
              {repo.commits.map((commit) => (
                <div key={`${repo.path}:${commit.hash}`} className="flex items-start gap-2">
                  <p className={`text-[10px] leading-tight ${
                    isNight ? "text-indigo-200" : "text-stone-600"
                  }`}>
                    <span className={`font-semibold ${isNight ? "text-indigo-300" : "text-stone-700"}`}>
                      {repo.name}
                    </span>
                    <span className={isNight ? "text-indigo-500" : "text-stone-400"}> | </span>
                    <span>{commit.message}</span>
                    <span className={isNight ? "text-indigo-500" : "text-stone-400"}> | </span>
                    <span className={isNight ? "text-indigo-400" : "text-stone-500"}>
                      {formatCommitTime(commit.timestamp)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )) : (
            <p className={`text-[10px] ${isNight ? "text-indigo-300" : "text-stone-500"}`}>
              오늘 기록된 커밋이 없습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
