import { useDashboardStore } from "../../stores/use-dashboard-store";
import { KUMA_TEAM } from "../../types/agent";
import { AgentAvatar } from "../shared/AgentAvatar";

export function AceAgentWidget() {
  const aceAgent = useDashboardStore((s) => s.stats.aceAgent);
  const tokensByAgent = useDashboardStore((s) => s.stats.tokensByAgent);
  const aceTeamMember = aceAgent
    ? KUMA_TEAM.find((agent) => agent.id === aceAgent.id) ?? null
    : null;

  const agentEntries = Object.entries(tokensByAgent)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">오늘의 MVP</h3>
      </div>
      <div className="p-5">
        {aceAgent && aceTeamMember ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-amber-50 p-4">
            <AgentAvatar name={aceTeamMember.nameKo} size="lg" />
            <div>
              <p className="text-sm font-bold text-amber-900">{aceTeamMember.nameKo}</p>
              <p className="text-xs text-amber-700">{aceTeamMember.roleKo}</p>
              <p className="text-xs text-amber-600">
                점수: {aceAgent.score.toFixed(1)}
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-lg bg-stone-50 p-4 text-center text-sm text-stone-400">
            아직 MVP가 결정되지 않았습니다
          </div>
        )}

        {agentEntries.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">토큰 사용 상위 에이전트</p>
            {agentEntries.map(([agent, tokens]) => {
              const member = KUMA_TEAM.find((m) => m.id === agent);
              return (
                <div key={agent} className="flex items-center justify-between text-sm">
                  <span className="text-stone-700">
                    {member?.nameKo ?? agent}
                  </span>
                  <span className="text-stone-500">{tokens.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
