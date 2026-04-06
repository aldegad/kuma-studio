import { useState } from "react";
import { useDashboardStore } from "../../stores/use-dashboard-store";

export function TokenUsageChart() {
  const stats = useDashboardStore((s) => s.stats);
  const tokenHistory = useDashboardStore((s) => s.tokenHistory);
  const [collapsed, setCollapsed] = useState(true);

  const modelEntries = Object.entries(stats.tokensByModel);

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
      style={{ background: "var(--panel-bg)", borderColor: "var(--panel-border)", color: "var(--t-primary)" }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "var(--t-muted)" }}
        >
          토큰 사용량 ({stats.totalTokens.toLocaleString()})
        </span>
        <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
      <div className="px-3 pb-3 space-y-2">
        {modelEntries.length === 0 && tokenHistory.length === 0 ? (
          <p className="py-4 text-center text-[10px]" style={{ color: "var(--t-faint)" }}>
            에이전트가 작업을 시작하면 토큰 사용량이 여기에 표시됩니다.
          </p>
        ) : (
          <div className="space-y-2">
            {modelEntries.map(([model, tokens]) => {
              const pct = stats.totalTokens > 0 ? (tokens / stats.totalTokens) * 100 : 0;
              return (
                <div key={model}>
                  <div className="mb-1 flex justify-between text-[10px]">
                    <span className="font-medium" style={{ color: "var(--t-secondary)" }}>{model}</span>
                    <span style={{ color: "var(--t-muted)" }}>{tokens.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--track-bg)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: "var(--t-muted)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
