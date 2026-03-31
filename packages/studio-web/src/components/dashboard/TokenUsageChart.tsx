import { useDashboardStore } from "../../stores/use-dashboard-store";

export function TokenUsageChart() {
  const stats = useDashboardStore((s) => s.stats);
  const tokenHistory = useDashboardStore((s) => s.tokenHistory);

  const modelEntries = Object.entries(stats.tokensByModel);

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">Token Usage</h3>
      </div>
      <div className="p-5">
        <div className="mb-4">
          <p className="text-3xl font-bold text-stone-900">
            {stats.totalTokens.toLocaleString()}
          </p>
          <p className="text-sm text-stone-500">total tokens consumed</p>
        </div>

        {modelEntries.length === 0 && tokenHistory.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">
            Token usage data will appear here when agents start working.
          </div>
        ) : (
          <div className="space-y-3">
            {modelEntries.map(([model, tokens]) => {
              const pct = stats.totalTokens > 0 ? (tokens / stats.totalTokens) * 100 : 0;
              return (
                <div key={model}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-stone-700">{model}</span>
                    <span className="text-stone-500">{tokens.toLocaleString()}</span>
                  </div>
                  <div className="h-2 rounded-full bg-stone-100">
                    <div
                      className="h-2 rounded-full bg-amber-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
