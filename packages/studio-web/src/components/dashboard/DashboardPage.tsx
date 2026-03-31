import { useWebSocket } from "../../hooks/use-websocket";
import { StatsCards } from "./StatsCards";
import { JobStatusPanel } from "./JobStatusPanel";
import { TokenUsageChart } from "./TokenUsageChart";
import { AceAgentWidget } from "./AceAgentWidget";
import { ActivityTimeline } from "./ActivityTimeline";

export function DashboardPage() {
  const { status } = useWebSocket();

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <JobStatusPanel />
        <ActivityTimeline />
      </div>
    </div>
  );
}
