import type { JobStatus } from "../../types/job-card";

const statusConfig: Record<JobStatus, { label: string; classes: string; themed?: boolean }> = {
  queued: { label: "대기", classes: "", themed: true },
  in_progress: { label: "진행 중", classes: "bg-blue-100 text-blue-700" },
  completed: { label: "완료", classes: "bg-green-100 text-green-700" },
  error: { label: "오류", classes: "bg-red-100 text-red-700" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const config = statusConfig[status] ?? statusConfig.queued;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.classes}`}
      style={config.themed ? { background: "var(--badge-bg)", color: "var(--badge-text)" } : undefined}
    >
      {config.label}
    </span>
  );
}
