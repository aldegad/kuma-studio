import { useDashboardStore } from "../../stores/use-dashboard-store";

interface StatCardProps {
  label: string;
  value: number;
  color: string;
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-stone-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

export function StatsCards() {
  const stats = useDashboardStore((s) => s.stats);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard label="Total Jobs" value={stats.totalJobs} color="text-stone-900" />
      <StatCard label="In Progress" value={stats.inProgressJobs} color="text-blue-600" />
      <StatCard label="Completed" value={stats.completedJobs} color="text-green-600" />
      <StatCard label="Errors" value={stats.errorJobs} color="text-red-600" />
    </div>
  );
}
