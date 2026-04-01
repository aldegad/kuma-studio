import { useEffect, useState } from "react";
import { fetchGitLog } from "../../lib/api";

interface Commit {
  hash: string;
  message: string;
}

export function GitLogPanel({ isNight }: { isNight: boolean }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    void fetchGitLog()
      .then((data) => setCommits(data.commits))
      .catch(() => {});
    const timer = setInterval(() => {
      void fetchGitLog()
        .then((data) => setCommits(data.commits))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (commits.length === 0) return null;

  return (
    <div className={`rounded-2xl backdrop-blur-md border shadow-lg overflow-hidden ${
      isNight ? "bg-indigo-950/70 border-indigo-800/40" : "bg-white/75 border-white/50"
    }`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-stone-50/30 transition-colors"
      >
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isNight ? "text-indigo-400" : "text-stone-500"}`}>
          Git 로그
        </span>
        <span className={`text-[10px] ${isNight ? "text-indigo-500" : "text-stone-400"}`}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-1 max-h-36 overflow-y-auto">
          {commits.map((commit) => (
            <div key={commit.hash} className="flex items-start gap-2">
              <code className={`text-[9px] font-mono flex-shrink-0 mt-0.5 ${
                isNight ? "text-indigo-400" : "text-stone-400"
              }`}>
                {commit.hash.slice(0, 7)}
              </code>
              <p className={`text-[10px] leading-tight ${
                isNight ? "text-indigo-200" : "text-stone-600"
              }`}>
                {commit.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
