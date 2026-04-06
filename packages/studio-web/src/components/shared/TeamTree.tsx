import { KUMA_TEAM, type Agent } from "../../types/agent";
import { useOfficeStore } from "../../stores/use-office-store";
import { STATE_COLORS } from "../../lib/constants";
import type { OfficeCharacter } from "../../types/office";

function buildTree(agents: Agent[]): Agent & { children: (Agent & { children: Agent[] })[] } {
  const root = agents.find((a) => a.nodeType === "session");
  if (!root) return { ...agents[0], children: [] };

  const teams = agents.filter((a) => a.parentId === root.id && a.nodeType === "team");
  return {
    ...root,
    children: teams.map((team) => ({
      ...team,
      children: agents.filter((a) => a.parentId === team.id && a.nodeType === "worker"),
    })),
  };
}

function StateDot({ state }: { state: string }) {
  const color = STATE_COLORS[state] ?? STATE_COLORS.idle;
  const isActive = state === "working" || state === "thinking";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${isActive ? "animate-pulse" : ""}`}
      style={{ backgroundColor: color }}
    />
  );
}

export function TeamTree() {
  const characters = useOfficeStore((s) => s.scene.characters) as OfficeCharacter[];
  const stateMap = new Map(characters.map((c) => [c.id, c.state]));
  const tree = buildTree(KUMA_TEAM);

  function getState(id: string): string {
    return stateMap.get(id) ?? "idle";
  }

  return (
    <div className="space-y-1 text-[11px]">
      {/* Root */}
      <div className="flex items-center gap-1.5 px-1 py-0.5 rounded font-semibold" style={{ color: "var(--t-secondary)" }}>
        <StateDot state={getState(tree.id)} />
        <span>{tree.emoji} {tree.nameKo}</span>
        <span className="text-[9px] ml-auto" style={{ color: "var(--t-faint)" }}>{tree.roleKo}</span>
      </div>
      {/* Teams */}
      {tree.children.map((team) => (
        <div key={team.id} className="ml-2">
          <div className="flex items-center gap-1.5 px-1 py-0.5 rounded font-medium" style={{ color: "var(--t-secondary)" }}>
            <StateDot state={getState(team.id)} />
            <span>{team.emoji} {team.nameKo}</span>
            <span className="text-[9px] ml-auto" style={{ color: "var(--t-faint)" }}>{team.teamKo}</span>
          </div>
          {/* Workers */}
          {team.children.map((worker) => (
            <div
              key={worker.id}
              className="ml-3 flex items-center gap-1.5 px-1 py-0.5 rounded"
              style={{
                color: "var(--t-muted)",
                background: getState(worker.id) !== "idle" ? "var(--card-bg)" : undefined,
              }}
            >
              <StateDot state={getState(worker.id)} />
              <span>{worker.emoji} {worker.nameKo}</span>
              {worker.model?.includes("codex") && (
                <span className="ml-auto rounded-full bg-emerald-100 px-1 text-[8px] text-emerald-700">codex</span>
              )}
              {worker.model?.includes("sonnet") && (
                <span className="ml-auto rounded-full bg-blue-100 px-1 text-[8px] text-blue-600">sonnet</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
