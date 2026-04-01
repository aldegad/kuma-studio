import { useDashboardStore } from "../../stores/use-dashboard-store";
import { StatusBadge } from "../shared/StatusBadge";

export function ActivityTimeline() {
  const jobs = useDashboardStore((s) => s.jobs);
  const recent = jobs.slice(0, 10);

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">활동 타임라인</h3>
      </div>
      <div className="max-h-80 overflow-y-auto p-5">
        {recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">
            에이전트가 작업하면 활동 내역이 여기에 표시됩니다.
          </div>
        ) : (
          <div className="relative space-y-4">
            <div className="absolute left-3 top-2 h-[calc(100%-16px)] w-px bg-stone-200" />
            {recent.map((job) => (
              <div key={`${job.id}-${job.updatedAt}`} className="relative flex gap-4 pl-8">
                <div className="absolute left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-white bg-stone-300 shadow-sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-stone-800">{job.message}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-xs text-stone-400">
                    {job.author} &middot; {new Date(job.updatedAt).toLocaleTimeString("ko-KR")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
