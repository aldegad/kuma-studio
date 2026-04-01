import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { STATE_COLORS, STATE_LABELS_KO } from "../../lib/constants";

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

        {/* Team */}
        <div className="text-[9px] text-stone-400 mb-1">
          <span className="text-stone-500">팀:</span> {member.teamKo}
        </div>

        {/* Model */}
        {member.model && (
          <div className="text-[9px] text-stone-400 mb-1">
            <span className="text-stone-500">모델:</span> {member.model}
          </div>
        )}

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
              >
                {skill}
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
