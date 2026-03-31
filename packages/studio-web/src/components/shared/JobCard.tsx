import type { JobCard as JobCardType } from "../../types/job-card";
import { StatusBadge } from "./StatusBadge";

interface JobCardProps {
  job: JobCardType;
}

export function JobCard({ job }: JobCardProps) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-stone-500">{job.author}</span>
        <StatusBadge status={job.status} />
      </div>
      <p className="text-sm text-stone-800">{job.message}</p>
      {job.tokensUsed > 0 && (
        <p className="mt-2 text-xs text-stone-400">
          {job.tokensUsed.toLocaleString()} tokens
          {job.model && ` (${job.model})`}
        </p>
      )}
      <p className="mt-1 text-xs text-stone-300">
        {new Date(job.updatedAt).toLocaleString()}
      </p>
    </div>
  );
}
