import { useDashboardStore } from "../../stores/use-dashboard-store";
import { StatusBadge } from "../shared/StatusBadge";

export function JobStatusPanel() {
  const jobs = useDashboardStore((s) => s.jobs);

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">최근 작업</h3>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-400">
            아직 작업이 없습니다. 브라우저 작업을 시작하면 여기에 표시됩니다.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800">{job.message}</p>
                  <p className="text-xs text-stone-400">
                    {job.author} &middot; {new Date(job.updatedAt).toLocaleTimeString("ko-KR")}
                  </p>
                </div>
                <StatusBadge status={job.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
