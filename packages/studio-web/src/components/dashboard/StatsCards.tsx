import { useDashboardStore } from "../../stores/use-dashboard-store";

interface StatCardProps {
  label: string;
  value: number;
  color: string;
  icon: string;
}

function StatCard({ label, value, color, icon }: StatCardProps) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-stone-500">{label}</p>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={`mt-1 text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

export function StatsCards() {
  const stats = useDashboardStore((s) => s.stats);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard label="전체 작업" value={stats.totalJobs} color="text-stone-900" icon="&#x1F4CB;" />
      <StatCard label="진행 중" value={stats.inProgressJobs} color="text-blue-600" icon="&#x1F528;" />
      <StatCard label="완료" value={stats.completedJobs} color="text-green-600" icon="&#x2705;" />
      <StatCard label="오류" value={stats.errorJobs} color="text-red-600" icon="&#x26A0;" />
    </div>
  );
}
