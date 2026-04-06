import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { STATE_COLORS, STATE_LABELS_KO, formatModelName, getSkillDisplayName, formatEffort, effortColorClass, contextBarColor } from "../../lib/constants";
import { useTeamStatusStore } from "../../stores/use-team-status-store";

interface CharacterTooltipProps {
  character: OfficeCharacter;
}

export function CharacterTooltip({ character }: CharacterTooltipProps) {
  const member = KUMA_TEAM.find((m) => m.id === character.id);
  if (!member) return null;

  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  const stateLabel = STATE_LABELS_KO[character.state] ?? character.state;

  return (
    <div className="tooltip-enter absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full z-30 w-48 pointer-events-none">
      <div className="rounded-xl bg-stone-900/90 backdrop-blur-sm text-white p-3 shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{member.emoji}</span>
          <div>
            <p className="text-xs font-bold">{member.nameKo}</p>
            <p className="text-[9px] text-stone-400">{member.roleKo}</p>
          </div>
        </div>

        {/* State */}
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-md bg-stone-800/80">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: stateColor }}
          />
          <span className="text-[10px]">{stateLabel}</span>
        </div>

        {character.task && (character.state === "working" || character.state === "thinking") && (
          <div className="mb-2 rounded-md bg-blue-500/10 px-2 py-1 text-[9px] text-blue-200">
            작업 중: {character.task}
          </div>
        )}

        {/* Team */}
        <div className="text-[9px] text-stone-400 mb-1">
          <span className="text-stone-500">팀:</span> {member.teamKo}
        </div>

        {/* Model — live info from team-status when available */}
        {member.model && (() => {
          const live = useTeamStatusStore.getState().memberStatus.get(character.id)?.modelInfo;
          const liveModel = live?.model ? formatModelName(live.model) : null;
          const display = liveModel ?? formatModelName(member.model) ?? member.model;
          const effort = formatEffort(live?.effort);
          const eCls = effortColorClass(live?.effort);
          const ctx = live?.contextRemaining;
          return (
            <div className="text-[9px] text-stone-400 mb-1">
              <span className="text-stone-500">모델:</span>{" "}
              <span className="font-medium text-stone-300">{display}</span>
              {effort && <span className={`ml-1 font-bold ${eCls}`}>{effort}</span>}
              {live?.speed && <span className="ml-0.5 opacity-60">⚡</span>}
              {ctx != null && (
                <span className="ml-1.5 inline-flex items-center gap-1">
                  <span className="inline-block w-8 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${ctx}%`, backgroundColor: contextBarColor(ctx) }} />
                  </span>
                  <span className={`text-[8px] ${ctx <= 20 ? "text-red-400" : "text-stone-500"}`}>{ctx}%</span>
                </span>
              )}
            </div>
          );
        })()}

        {/* Node type */}
        {member.nodeType && (
          <div className="text-[9px] text-stone-400 mb-1">
            <span className="text-stone-500">타입:</span>{" "}
            {member.nodeType === "session" ? "세션 (총괄)" : member.nodeType === "team" ? "팀 리더" : "워커"}
          </div>
        )}

        {/* Skills */}
        {member.skills && member.skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {member.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[8px] text-amber-300"
                title={skill}
              >
                {getSkillDisplayName(skill)}
              </span>
            ))}
          </div>
        )}

        {/* Arrow */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-stone-900/90 rotate-45" />
      </div>
    </div>
  );
}
