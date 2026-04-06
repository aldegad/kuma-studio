import type { JobCard as JobCardType } from "../../types/job-card";
import { StatusBadge } from "./StatusBadge";

interface JobCardProps {
  job: JobCardType;
}

export function JobCard({ job }: JobCardProps) {
  return (
    <div className="rounded-lg border p-4 shadow-sm" style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "var(--t-muted)" }}>{job.author}</span>
        <StatusBadge status={job.status} />
      </div>
      <p className="text-sm" style={{ color: "var(--t-primary)" }}>{job.message}</p>
      {job.tokensUsed > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--t-faint)" }}>
          {job.tokensUsed.toLocaleString()} 토큰
          {job.model && ` (${job.model})`}
        </p>
      )}
      <p className="mt-1 text-xs" style={{ color: "var(--t-faint)" }}>
        {new Date(job.updatedAt).toLocaleString("ko-KR")}
      </p>
    </div>
  );
}
