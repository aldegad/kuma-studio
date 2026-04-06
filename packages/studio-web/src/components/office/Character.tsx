import { useState, type MouseEvent } from "react";
import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { CharacterSprite } from "./CharacterSprite";
import { CharacterTooltip } from "./CharacterTooltip";
import { useRandomEmote } from "../../hooks/use-random-emote";
import { STATE_COLORS, STATE_LABELS_KO, formatModelName, modelBadgeClass, getSkillDisplayName, formatEffort, effortColorClass, contextBarColor } from "../../lib/constants";
import { useTeamStatusStore, type ModelInfo } from "../../stores/use-team-status-store";

interface CharacterProps {
  character: OfficeCharacter;
  isDragging?: boolean;
  isSelected?: boolean;
  speechBubble?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

const STATE_EMOJI: Record<string, string> = {
  working: "\u26A1",
  thinking: "\uD83D\uDCAD",
  idle: "\uD83D\uDCA4",
  completed: "\u2705",
  error: "\u274C",
};

export function Character({ character, isDragging = false, isSelected = false, speechBubble, onClick, onDragStart, onDoubleClick }: CharacterProps) {
  const [hovered, setHovered] = useState(false);
  const randomEmote = useRandomEmote(character.id, character.state === "idle");
  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  const stateLabel = STATE_LABELS_KO[character.state] ?? character.state;
  const teamMember = KUMA_TEAM.find((m) => m.id === character.id);
  const displayName = teamMember?.nameKo ?? character.name;
  const displayRole = teamMember?.roleKo ?? character.role;
  const displayEmoji = teamMember?.emoji ?? "";
  const model = teamMember?.model;
  const shortModel = formatModelName(model);
  const skills = teamMember?.skills ?? [];

  // Live model info from team-status API
  const liveModelInfo: ModelInfo | null = useTeamStatusStore((s) => s.memberStatus.get(character.id)?.modelInfo ?? null);
  const liveModel = liveModelInfo?.model ? formatModelName(liveModelInfo.model) : null;
  const displayModel = liveModel ?? shortModel;
  const badgeModel = liveModelInfo?.model ?? model;
  const effort = formatEffort(liveModelInfo?.effort);
  const effortClass = effortColorClass(liveModelInfo?.effort);
  const contextPct = liveModelInfo?.contextRemaining;

  return (
    <div
      className={`absolute flex select-none flex-col items-center ${
        isDragging ? "z-20 cursor-grabbing" : "transition-all duration-300 ease-in-out cursor-grab"
      }`}
      onMouseDown={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        left: character.position.x,
        top: character.position.y,
        transform: "translate(-50%, -50%)",
        animation: isDragging ? "none" : `float-idle ${2.5 + (character.id.charCodeAt(0) % 5) * 0.3}s ease-in-out infinite`,
      }}
    >
      {/* Random emote bubble for idle characters */}
      {randomEmote && !speechBubble && (
        <div className="mb-1 animate-fade-in pointer-events-none">
          <span className="text-lg drop-shadow-md" style={{ animation: "zzz-float 2.5s ease-out forwards" }}>
            {randomEmote}
          </span>
        </div>
      )}

      {/* Hover tooltip */}
      {hovered && !isDragging && <CharacterTooltip character={character} />}

      {/* Speech bubble */}
      {speechBubble && (
        <div className="mb-1 max-w-32 rounded-lg bg-white/95 border border-stone-200 px-2 py-1 shadow-sm relative">
          <p className="text-[8px] text-stone-600 leading-tight truncate">{speechBubble}</p>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/95 border-r border-b border-stone-200 rotate-45" />
        </div>
      )}

      {/* Card container — glow based on state */}
      <div
        className={`character-card relative flex w-30 flex-col items-center rounded-xl border p-2 shadow-md backdrop-blur-sm ${
          character.state === "working"
            ? "border-blue-400 bg-blue-50/85 shadow-blue-300/60 ring-2 ring-blue-400/50 animate-state-glow animate-sparkle"
            : character.state === "thinking"
            ? "border-amber-300 bg-amber-50/80 shadow-amber-200/50 ring-2 ring-amber-300/40 animate-state-glow animate-sparkle"
            : character.state === "error"
            ? "border-red-300 bg-red-50/80 shadow-red-200/50 ring-2 ring-red-300/40 animate-state-glow animate-error-shake"
            : character.state === "completed"
            ? "border-green-300 bg-green-50/80 shadow-green-200/50 animate-completion-pop"
            : character.state === "idle"
            ? "border-white/50 bg-white/80 animate-zzz"
            : "border-white/50 bg-white/80"
        } ${isSelected ? "ring-2 ring-amber-400 ring-offset-1" : ""
        }`}
        style={{
          "--glow-color": character.state === "working"
            ? "rgba(96, 165, 250, 0.4)"
            : character.state === "thinking"
            ? "rgba(245, 158, 11, 0.35)"
            : character.state === "error"
            ? "rgba(248, 113, 113, 0.4)"
            : undefined,
        } as React.CSSProperties}
      >
        {/* Avatar */}
        <CharacterSprite character={character} />

        {/* State indicator */}
        <div className="mt-1 flex items-center gap-1">
          <span className="text-[8px]">{STATE_EMOJI[character.state] ?? ""}</span>
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: stateColor }}
            title={stateLabel}
          />
          <span className="text-[8px] text-stone-400 font-medium">{stateLabel}</span>
        </div>

        {/* Working progress bar */}
        {(character.state === "working" || character.state === "thinking") && (
          <div className="working-progress-bar mt-1 w-full" />
        )}

        {character.state === "working" && character.task && (
          <p className="mt-1 w-full rounded-md bg-blue-100/80 px-1.5 py-1 text-center text-[8px] font-medium leading-tight text-blue-700">
            작업 중: {character.task}
          </p>
        )}

        {/* Model badge — shows live effort/speed when available */}
        {displayModel && (
          <div className="mt-1 flex flex-col items-center gap-0.5">
            <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[7px] font-semibold leading-tight ${modelBadgeClass(badgeModel)}`}>
              {displayModel}
              {effort && (
                <span className={`font-bold ${effortClass}`}>
                  {effort}
                </span>
              )}
              {liveModelInfo?.speed && (
                <span className="opacity-60">⚡</span>
              )}
            </span>
            {/* Context remaining micro-bar */}
            {contextPct != null && (
              <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.1)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${contextPct}%`,
                    backgroundColor: contextBarColor(contextPct),
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-0.5">
            {skills.slice(0, 2).map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] text-amber-800"
                title={skill}
              >
                {getSkillDisplayName(skill)}
              </span>
            ))}
            {skills.length > 2 && (
              <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[8px] text-stone-500" title={skills.slice(2).map(getSkillDisplayName).join(", ")}>
                +{skills.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Name plate — game RPG style */}
        <div className="character-name-plate mt-1.5 -mx-2 -mb-2 px-2 py-1.5 rounded-b-lg">
          <p className="text-[11px] font-bold text-amber-100 text-center" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
            {displayEmoji} {displayName}
          </p>
          <p className="text-[9px] text-stone-300/80 text-center">{displayRole}</p>
        </div>
      </div>
    </div>
  );
}
