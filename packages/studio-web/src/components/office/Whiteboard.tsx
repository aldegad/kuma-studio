import { useEffect, useState } from "react";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import { KUMA_TEAM } from "../../types/agent";
import { fetchGitLog } from "../../lib/api";
import { StatusBadge } from "../shared/StatusBadge";

interface WhiteboardProps {
  position: { x: number; y: number };
}

export function Whiteboard({ position }: WhiteboardProps) {
  const jobs = useDashboardStore((s) => s.jobs);
  const stats = useDashboardStore((s) => s.stats);
  const dailyReport = useDashboardStore((s) => s.dailyReport);
  const recentJobs = jobs.slice(0, 3);

  const [commits, setCommits] = useState<{ hash: string; message: string }[]>([]);
  useEffect(() => {
    void fetchGitLog()
      .then((d) => setCommits(d.commits?.slice(0, 5) || []))
      .catch(() => {});
  }, []);

  const today = new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });

  return (
    <div
      className="pointer-events-none absolute rounded-lg border-2 border-stone-300 bg-white/90 p-3 shadow-md"
      style={{
        left: position.x,
        top: position.y,
        width: 220,
        minHeight: 120,
        transform: "translate(-50%, 0)",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-600">작업 보드</span>
        <span className="text-[9px] text-stone-400">{today}</span>
      </div>

      {/* Stats summary row */}
      {(stats.totalJobs > 0 || stats.completedJobs > 0) && (
        <div className="mb-2 flex gap-2 text-[9px]">
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600 font-medium">진행 {stats.inProgressJobs}</span>
          <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-600 font-medium">완료 {stats.completedJobs}</span>
          {stats.errorJobs > 0 && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600 font-medium">오류 {stats.errorJobs}</span>
          )}
        </div>
      )}

      {recentJobs.length > 0 ? (
        <div className="space-y-1.5">
          {recentJobs.map((job) => (
            <div
              key={job.id}
              className="rounded border border-amber-200/60 bg-amber-50/50 px-2 py-1"
            >
              <div className="flex items-center justify-between">
                <p className="truncate text-[10px] font-medium text-stone-700">
                  {job.message.slice(0, 30)}
                </p>
                <StatusBadge status={job.status} />
              </div>
            </div>
          ))}
        </div>
      ) : dailyReport ? (
        <div className="space-y-1 text-[10px] text-stone-500">
          <p>전체 {dailyReport.totalTasks}건 / 완료 {dailyReport.completedTasks}건</p>
          <p>달성률 {Math.round(dailyReport.completionRate * 100)}%</p>
          {dailyReport.mvpAgent && (() => {
            const mvpMember = KUMA_TEAM.find((m) => m.id === dailyReport.mvpAgent!.id);
            return (
              <p className="text-amber-600 font-medium">
                MVP: {mvpMember?.emoji ?? ""} {mvpMember?.nameKo ?? dailyReport.mvpAgent!.id}
              </p>
            );
          })()}
        </div>
      ) : (
        <p className="text-center text-[10px] text-stone-400 py-2">오늘의 작업을 시작해보세요</p>
      )}

      {/* Recent commits */}
      {commits.length > 0 && (
        <div className="mt-2 border-t border-stone-200/50 pt-1.5">
          <p className="text-[9px] font-bold text-stone-400 uppercase mb-1">최근 커밋</p>
          <div className="space-y-0.5">
            {commits.map((c) => (
              <p key={c.hash} className="text-[8px] text-stone-400 truncate">
                <span className="font-mono text-stone-500">{c.hash.slice(0, 7)}</span>{" "}
                {c.message.slice(0, 35)}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
