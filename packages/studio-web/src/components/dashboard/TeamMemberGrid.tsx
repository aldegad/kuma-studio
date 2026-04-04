import type { Agent } from "../../types/agent";
import { useOfficeStore } from "../../stores/use-office-store";
import { STATE_COLORS, STATE_LABELS_KO, TEAM_COLORS, TEAM_LABELS_KO } from "../../lib/constants";
import teamData from "../../../../shared/team.json";

function shortModelLabel(model?: string): { label: string; color: string } {
  if (!model) return { label: "", color: "#78716c" };
  if (model.includes("codex")) return { label: "Codex", color: "#10B981" };
  if (model.includes("opus")) return { label: "Opus", color: "#8B5CF6" };
  if (model.includes("sonnet")) return { label: "Sonnet", color: "#F59E0B" };
  if (model.includes("haiku")) return { label: "Haiku", color: "#06B6D4" };
  return { label: model.split("-").pop() ?? model, color: "#78716c" };
}

const animalEmojiCode: Record<string, string> = {
  ...Object.fromEntries(
    teamData.members.map((member) => [
      member.animal.en,
      Array.from(member.emoji.replace(/\uFE0F/g, ""))
        .map((char) => char.codePointAt(0)?.toString(16))
        .filter((code): code is string => Boolean(code))
        .join("-"),
    ]),
  ),
};

const stateAnimationClass: Record<string, string> = {
  idle: "",
  working: "animate-typing",
  thinking: "animate-float",
  completed: "animate-ping-once",
  error: "animate-shake",
};

const teamById = new Map(teamData.teams.map((team) => [team.id, team] as const));
const teamMembers: Agent[] = teamData.members.map((member) => ({
  id: member.id,
  name: member.name.en,
  nameKo: member.name.ko,
  animal: member.animal.en,
  animalKo: member.animal.ko,
  role: member.role.en,
  roleKo: member.role.ko,
  team: member.team,
  teamKo: teamById.get(member.team)?.name.ko ?? member.team,
  state: "idle",
  nodeType: member.nodeType as Agent["nodeType"],
  parentId: member.parentId ?? undefined,
  model: member.model,
  emoji: member.emoji,
  image: member.image,
  skills: member.skills as Agent["skills"],
}));

export function TeamMemberGrid() {
  const characters = useOfficeStore((s) => s.scene.characters);

  const characterMap = characters.reduce((map, character) => {
    map.set(character.id, character);
    if (character.id === "rumi") {
      map.set("lumi", character);
    }
    return map;
  }, new Map<string, (typeof characters)[number]>());

  const grouped = teamData.teams.map((team) => ({
    team: team.id,
    label: team.name.ko ?? TEAM_LABELS_KO[team.id] ?? team.id,
    color: TEAM_COLORS[team.id] ?? "#78716c",
    members: teamMembers.filter((a) => a.team === team.id),
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
                const character = characterMap.get(agent.id);
                const agentState = character?.state ?? agent.state;
                const task = character?.task ?? null;
                const stateColor = STATE_COLORS[agentState] ?? STATE_COLORS.idle;
                const stateLabel = STATE_LABELS_KO[agentState] ?? agentState;
                const emojiCode = animalEmojiCode[agent.animal] ?? "1f43b";
                const animation = stateAnimationClass[agentState] ?? "";
                const isWorking = agentState === "working";
                const modelInfo = shortModelLabel(agent.model);

                return (
                  <div
                    key={agent.id}
                    className={`group relative flex flex-col items-center rounded-xl border px-3 py-4 transition-all hover:shadow-sm ${
                      isWorking
                        ? "border-stone-400 bg-stone-100/70 shadow-sm shadow-stone-200 hover:border-stone-500 hover:bg-stone-100"
                        : "border-stone-100 bg-stone-50/50 hover:border-stone-300 hover:bg-stone-100/50"
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`relative mb-2 ${animation}`}>
                      <div
                        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-md transition-transform group-hover:scale-110 ${
                          isWorking ? "ring-4 ring-stone-400/35" : ""
                        }`}
                        style={{
                          backgroundColor: isWorking ? "#E7E5E4" : `${color}18`,
                          border: `2px solid ${isWorking ? "#A8A29E" : `${color}40`}`,
                        }}
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

                    {/* Model badge */}
                    {modelInfo.label && (
                      <span
                        className="mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold"
                        style={{
                          backgroundColor: `${modelInfo.color}15`,
                          color: modelInfo.color,
                          border: `1px solid ${modelInfo.color}30`,
                        }}
                      >
                        {modelInfo.label}
                      </span>
                    )}

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

                    {isWorking && task && (
                      <p className="mt-2 w-full rounded-lg bg-stone-200 px-2 py-1 text-center text-[10px] font-medium leading-tight text-stone-700">
                        작업 중: {task}
                      </p>
                    )}
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
