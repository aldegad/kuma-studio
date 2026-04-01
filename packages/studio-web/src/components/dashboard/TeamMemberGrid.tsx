import { KUMA_TEAM } from "../../types/agent";
import { useOfficeStore } from "../../stores/use-office-store";
import { STATE_COLORS, STATE_LABELS_KO, TEAM_COLORS, TEAM_LABELS_KO } from "../../lib/constants";

const animalEmojiCode: Record<string, string> = {
  bear: "1f43b",
  fox: "1f98a",
  chipmunk: "1f43f",
  eagle: "1f985",
  wolf: "1f43a",
  beaver: "1f9ab",
  parrot: "1f99c",
  hedgehog: "1f994",
  deer: "1f98c",
  rabbit: "1f430",
  cat: "1f431",
  hamster: "1f439",
};

const stateAnimationClass: Record<string, string> = {
  idle: "",
  working: "animate-typing",
  thinking: "animate-float",
  completed: "animate-ping-once",
  error: "animate-shake",
};

const teamOrder = ["management", "analytics", "dev", "strategy"] as const;

export function TeamMemberGrid() {
  const characters = useOfficeStore((s) => s.scene.characters);

  const stateMap = new Map(characters.map((c) => [c.id, c.state]));

  const grouped = teamOrder.map((team) => ({
    team,
    label: TEAM_LABELS_KO[team] ?? team,
    color: TEAM_COLORS[team] ?? "#78716c",
    members: KUMA_TEAM.filter((a) => a.team === team),
  }));

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">쿠마팀 현황</h3>
        <p className="mt-0.5 text-xs text-stone-500">팀원들의 실시간 상태를 확인하세요</p>
      </div>

      <div className="space-y-5 p-5">
        {grouped.map(({ team, label, color, members }) => (
          <div key={team}>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
                {label}
              </span>
              <div className="flex-1 border-t border-stone-100" />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6">
              {members.map((agent) => {
                const agentState = stateMap.get(agent.id) ?? agent.state;
                const stateColor = STATE_COLORS[agentState] ?? STATE_COLORS.idle;
                const stateLabel = STATE_LABELS_KO[agentState] ?? agentState;
                const emojiCode = animalEmojiCode[agent.animal] ?? "1f43b";
                const animation = stateAnimationClass[agentState] ?? "";

                return (
                  <div
                    key={agent.id}
                    className="group relative flex flex-col items-center rounded-xl border border-stone-100 bg-stone-50/50 px-3 py-4 transition-all hover:border-amber-200 hover:bg-amber-50/50 hover:shadow-sm"
                  >
                    {/* Avatar */}
                    <div className={`relative mb-2 ${animation}`}>
                      <div
                        className="flex h-14 w-14 items-center justify-center rounded-full shadow-md transition-transform group-hover:scale-110"
                        style={{ backgroundColor: `${color}18`, border: `2px solid ${color}40` }}
                      >
                        <img
                          src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${emojiCode}.svg`}
                          alt={agent.animalKo}
                          className="h-8 w-8"
                          onError={(e) => {
                            const el = e.target as HTMLImageElement;
                            el.style.display = "none";
                            el.parentElement!.innerHTML = `<span class="text-xl font-bold" style="color:${color}">${agent.nameKo[0]}</span>`;
                          }}
                        />
                      </div>

                      {/* State dot */}
                      <div
                        className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white"
                        style={{ backgroundColor: stateColor }}
                        title={stateLabel}
                      />
                    </div>

                    {/* Name */}
                    <p className="text-xs font-bold text-stone-800">{agent.nameKo}</p>
                    <p className="text-[10px] text-stone-500">{agent.roleKo}</p>

                    {/* Status */}
                    <div
                      className="mt-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: `${stateColor}18`,
                        color: stateColor,
                      }}
                    >
                      {stateLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
