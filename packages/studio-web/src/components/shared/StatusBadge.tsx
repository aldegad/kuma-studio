import type { JobStatus } from "../../types/job-card";

const statusConfig: Record<JobStatus, { label: string; classes: string }> = {
  queued: { label: "Queued", classes: "bg-stone-100 text-stone-600" },
  in_progress: { label: "In Progress", classes: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", classes: "bg-green-100 text-green-700" },
  error: { label: "Error", classes: "bg-red-100 text-red-700" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const config = statusConfig[status] ?? statusConfig.queued;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.classes}`}
    >
      {config.label}
    </span>
  );
}
