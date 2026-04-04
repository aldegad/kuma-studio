import { useDashboardStore } from "../../stores/use-dashboard-store";

export function TokenUsageChart() {
  const stats = useDashboardStore((s) => s.stats);
  const tokenHistory = useDashboardStore((s) => s.tokenHistory);

  const modelEntries = Object.entries(stats.tokensByModel);

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">토큰 사용량</h3>
      </div>
      <div className="p-5">
        <div className="mb-4">
          <p className="text-3xl font-bold text-stone-900">
            {stats.totalTokens.toLocaleString()}
          </p>
          <p className="text-sm text-stone-500">총 소모 토큰</p>
        </div>

        {modelEntries.length === 0 && tokenHistory.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">
            에이전트가 작업을 시작하면 토큰 사용량이 여기에 표시됩니다.
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
                      className="h-2 rounded-full bg-stone-500 transition-all"
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
