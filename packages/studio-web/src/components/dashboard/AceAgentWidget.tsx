import { useDashboardStore } from "../../stores/use-dashboard-store";
import { AgentAvatar } from "../shared/AgentAvatar";

export function AceAgentWidget() {
  const aceAgent = useDashboardStore((s) => s.stats.aceAgent);
  const tokensByAgent = useDashboardStore((s) => s.stats.tokensByAgent);

  const agentEntries = Object.entries(tokensByAgent)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">Ace Agent</h3>
      </div>
      <div className="p-5">
        {aceAgent ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-amber-50 p-4">
            <AgentAvatar name={aceAgent.name} size="lg" />
            <div>
              <p className="text-sm font-bold text-amber-900">{aceAgent.name}</p>
              <p className="text-xs text-amber-700">
                Score: {aceAgent.score.toFixed(1)}
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-lg bg-stone-50 p-4 text-center text-sm text-stone-400">
            No ace agent determined yet
          </div>
        )}

        {agentEntries.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-stone-500 uppercase">Top Agents by Tokens</p>
            {agentEntries.map(([agent, tokens]) => (
              <div key={agent} className="flex items-center justify-between text-sm">
                <span className="text-stone-700">{agent}</span>
                <span className="text-stone-500">{tokens.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
