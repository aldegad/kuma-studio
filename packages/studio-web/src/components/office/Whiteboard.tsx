import { useDashboardStore } from "../../stores/use-dashboard-store";
import { StatusBadge } from "../shared/StatusBadge";

interface WhiteboardProps {
  position: { x: number; y: number };
}

export function Whiteboard({ position }: WhiteboardProps) {
  const jobs = useDashboardStore((s) => s.jobs);
  const commitCount = useDashboardStore((s) => s.gitActivity.totalCommitsToday);
  const inProgressJobs = jobs.filter((job) => job.status === "in_progress").slice(0, 3);

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

      {inProgressJobs.length > 0 ? (
        <div className="space-y-1.5">
          {inProgressJobs.map((job) => (
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
      ) : (
        <p className="py-2 text-center text-[10px] text-stone-400">현재 진행 중인 작업이 없습니다</p>
      )}

      <div className="mt-2 border-t border-stone-200/50 pt-1.5">
        <p className="text-[9px] font-bold uppercase text-stone-400">오늘 커밋: {commitCount}건</p>
      </div>
    </div>
  );
}
