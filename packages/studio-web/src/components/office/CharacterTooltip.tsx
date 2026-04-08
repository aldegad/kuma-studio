import type { OfficeCharacter } from "../../types/office";
import { STATE_COLORS, STATE_LABELS_KO, formatModelName, modelBadgeClass, getSkillDisplayName, formatEffort, effortColorClass, contextBarColor, getModelDefaults } from "../../lib/constants";
import { useTeamStatusStore } from "../../stores/use-team-status-store";
import { useTeamConfigStore } from "../../stores/use-team-config-store";

interface CharacterTooltipProps {
  character: OfficeCharacter;
}

export function CharacterTooltip({ character }: CharacterTooltipProps) {
  const members = useTeamConfigStore((s) => s.members);
  const member = members.find((m) => m.id === character.id);
  if (!member) return null;

  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  const stateLabel = STATE_LABELS_KO[character.state] ?? character.state;
  const liveStatus = useTeamStatusStore((s) => s.memberStatus.get(character.id));
  const liveModelInfo = liveStatus?.modelInfo ?? null;
  const liveModel = liveModelInfo?.model ? formatModelName(liveModelInfo.model) : null;
  const displayModel = liveModel ?? formatModelName(member.model) ?? member.model;
  const badgeModel = liveModelInfo?.model ?? member.model;
  const modelDefaults = getModelDefaults(member.model);
  const effectiveEffort = liveModelInfo?.effort ?? modelDefaults.effort;
  const effectiveSpeed = liveModelInfo?.speed ?? modelDefaults.speed;
  const effort = formatEffort(effectiveEffort);
  const effortCls = effortColorClass(effectiveEffort);
  const contextPct = liveModelInfo?.contextRemaining;
  const isActive = character.state === "working" || character.state === "thinking";

  const nodeLabel = member.nodeType === "session" ? "총괄 리더"
    : member.nodeType === "team" ? "팀 리더"
    : "워커";

  return (
    <div
      className="tooltip-enter absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full z-30 w-56 pointer-events-none"
      data-kuma-agent-overlay="tooltip"
    >
      <div className="rounded-xl bg-stone-900/92 backdrop-blur-md text-white p-3 shadow-2xl border border-white/5">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="text-xl">{member.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold truncate">{member.nameKo}</p>
            <p className="text-[9px] text-stone-400">{member.roleKo}</p>
          </div>
          <div
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${isActive ? "animate-pulse" : ""}`}
            style={{ backgroundColor: stateColor }}
          />
        </div>

        {/* State bar */}
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-stone-800/80">
          <span className="text-[10px] font-medium">{stateLabel}</span>
          {isActive && (
            <div className="working-progress-bar flex-1 ml-1" />
          )}
        </div>

        {/* Active task */}
        {character.task && isActive && (
          <div className="mb-2 rounded-lg bg-blue-500/15 px-2.5 py-1.5 text-[9px] text-blue-200 leading-relaxed">
            {character.task}
          </div>
        )}

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2 text-[9px]">
          <div>
            <span className="text-stone-500">팀</span>
            <span className="ml-1.5 text-stone-300">{member.teamKo}</span>
          </div>
          <div>
            <span className="text-stone-500">타입</span>
            <span className="ml-1.5 text-stone-300">{nodeLabel}</span>
          </div>
        </div>

        {/* Model info */}
        {displayModel && (
          <div className="rounded-lg bg-stone-800/60 px-2.5 py-2 mb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold leading-tight ${modelBadgeClass(badgeModel)}`}>
                {displayModel}
              </span>
              {effort && (
                <span className={`text-[9px] font-bold ${effortCls}`}>{effort}</span>
              )}
              {effectiveSpeed && (
                <span className="text-[9px] text-amber-400">⚡ {effectiveSpeed}</span>
              )}
            </div>
            {contextPct != null && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[8px] text-stone-500">ctx</span>
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${contextPct}%`, backgroundColor: contextBarColor(contextPct) }}
                  />
                </div>
                <span className={`text-[8px] font-bold ${contextPct <= 20 ? "text-red-400" : "text-stone-400"}`}>
                  {contextPct}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Skills */}
        {member.skills && member.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {member.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8px] text-amber-300 font-medium"
                title={skill}
              >
                {getSkillDisplayName(skill)}
              </span>
            ))}
          </div>
        )}

        {/* Arrow */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-stone-900/92 rotate-45 border-r border-b border-white/5" />
      </div>
    </div>
  );
}
