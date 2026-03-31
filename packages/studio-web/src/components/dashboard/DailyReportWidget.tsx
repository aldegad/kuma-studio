import { KUMA_TEAM } from "../../types/agent";
import { useDashboardStore } from "../../stores/use-dashboard-store";

export function DailyReportWidget() {
  const dailyReport = useDashboardStore((state) => state.dailyReport);
  const mvpAgent = dailyReport?.mvpAgent
    ? KUMA_TEAM.find((agent) => agent.id === dailyReport.mvpAgent?.id) ?? null
    : null;

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">Daily Report</h3>
      </div>
      <div className="p-5">
        {dailyReport ? (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{dailyReport.date}</p>
              <p className="mt-1 text-3xl font-bold text-stone-900">{dailyReport.totalTasks.toLocaleString()}</p>
              <p className="text-sm text-stone-500">tasks tracked today</p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Metric label="Completion Rate" value={`${dailyReport.completionRate.toFixed(1)}%`} tone="text-green-600" />
              <Metric label="Completed Tasks" value={dailyReport.completedTasks.toLocaleString()} tone="text-stone-900" />
              <Metric label="Token Consumption" value={dailyReport.tokenConsumption.toLocaleString()} tone="text-amber-700" />
            </div>

            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">MVP Agent</p>
              {dailyReport.mvpAgent ? (
                <>
                  <p className="mt-2 text-lg font-semibold text-amber-950">
                    {mvpAgent?.name ?? dailyReport.mvpAgent.id}
                  </p>
                  <p className="text-sm text-amber-800">
                    {dailyReport.mvpAgent.completedTasks.toLocaleString()} completed tasks and {dailyReport.mvpAgent.totalTokens.toLocaleString()} tokens
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-amber-800">No standout agent yet for today.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-stone-400">
            Daily report data will appear here after the server aggregates today's work.
          </div>
        )}
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  tone: string;
}

function Metric({ label, value, tone }: MetricProps) {
  return (
    <div className="rounded-lg bg-stone-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
