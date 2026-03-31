import { useEffect } from "react";
import { fetchDailyReport, fetchStats } from "../../lib/api";
import { useWebSocket } from "../../hooks/use-websocket";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import { StatsCards } from "./StatsCards";
import { JobStatusPanel } from "./JobStatusPanel";
import { TokenUsageChart } from "./TokenUsageChart";
import { AceAgentWidget } from "./AceAgentWidget";
import { ActivityTimeline } from "./ActivityTimeline";
import { DailyReportWidget } from "./DailyReportWidget";

export function DashboardPage() {
  const { status } = useWebSocket();
  const setStats = useDashboardStore((state) => state.setStats);
  const setDailyReport = useDashboardStore((state) => state.setDailyReport);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [stats, dailyReport] = await Promise.all([fetchStats(), fetchDailyReport()]);
        if (!cancelled) {
          setStats(stats);
          setDailyReport(dailyReport);
        }
      } catch {
        // Keep the dashboard live via websocket if the initial fetch fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setDailyReport, setStats]);

  return (
    <div className="space-y-6">
      {status !== "connected" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {status === "connecting"
            ? "Connecting to kuma-studio server..."
            : "Disconnected from server. Attempting to reconnect..."}
        </div>
      )}

      <StatsCards />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TokenUsageChart />
        <AceAgentWidget />
      </div>

      <DailyReportWidget />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <JobStatusPanel />
        <ActivityTimeline />
      </div>
    </div>
  );
}
