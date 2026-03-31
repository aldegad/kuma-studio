import { useDashboardStore } from "../../stores/use-dashboard-store";
import { StatusBadge } from "../shared/StatusBadge";

interface WhiteboardProps {
  position: { x: number; y: number };
}

export function Whiteboard({ position }: WhiteboardProps) {
  const jobs = useDashboardStore((s) => s.jobs);
  const recentJobs = jobs.slice(0, 3);

  return (
    <div
      className="pointer-events-none absolute rounded-lg border-2 border-stone-300 bg-white/90 p-3 shadow-md"
      style={{
        left: position.x,
        top: position.y,
        width: 200,
        minHeight: 120,
        transform: "translate(-50%, 0)",
      }}
    >
      <div className="mb-2 text-center text-xs font-bold text-stone-600 uppercase tracking-wide">
        Job Board
      </div>
      {recentJobs.length === 0 ? (
        <p className="text-center text-[10px] text-stone-400">No active jobs</p>
      ) : (
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
      )}
    </div>
  );
}
