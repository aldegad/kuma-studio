import { useState, type MouseEvent } from "react";
import type { OfficeCharacter } from "../../types/office";
import { CharacterSprite } from "./CharacterSprite";
import { CharacterTooltip } from "./CharacterTooltip";
import { useRandomEmote } from "../../hooks/use-random-emote";
import { STATE_COLORS, formatModelName, formatModelDetail } from "../../lib/constants";
import { useTeamStatusStore } from "../../stores/use-team-status-store";
import { useTeamConfigStore } from "../../stores/use-team-config-store";

interface CharacterProps {
  character: OfficeCharacter;
  isDragging?: boolean;
  isSelected?: boolean;
  speechBubble?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

export function Character({ character, isDragging = false, isSelected = false, speechBubble, onClick, onDragStart, onDoubleClick }: CharacterProps) {
  const [hovered, setHovered] = useState(false);
  const randomEmote = useRandomEmote(character.id, character.state === "idle");
  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  const members = useTeamConfigStore((s) => s.members);
  const teamMember = members.find((m) => m.id === character.id);
  const displayName = teamMember?.nameKo ?? character.name;
  const displayRole = teamMember?.roleKo ?? character.role;
  const model = teamMember?.model;

  const liveModelInfo = useTeamStatusStore((s) => s.memberStatus.get(character.id)?.modelInfo ?? null);
  const liveModel = liveModelInfo ? [
    formatModelName(liveModelInfo.model ?? undefined),
    liveModelInfo.effort,
    liveModelInfo.speed,
  ].filter(Boolean).join(" · ") || null : null;
  const displayModel = liveModel ?? formatModelDetail(model);

  const shouldFloat = !isDragging && (character.state === "idle" || character.state === "completed");
  const isActive = character.state === "working" || character.state === "thinking";

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
        animation: shouldFloat ? `float-idle ${2.5 + (character.id.charCodeAt(0) % 5) * 0.3}s ease-in-out infinite` : "none",
      }}
    >
      {/* Hover tooltip / popover */}
      {hovered && !isDragging && <CharacterTooltip character={character} />}

      {/* Card wrapper — relative so dot and emote/speech can escape overflow-hidden */}
      <div className="relative">
        {/* Random emote bubble — absolute so it doesn't push card down */}
        {randomEmote && !speechBubble && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 animate-fade-in pointer-events-none"
            data-kuma-agent-overlay="emote"
          >
            <span className="text-lg drop-shadow-md" style={{ animation: "zzz-float 2.5s ease-out forwards" }}>
              {randomEmote}
            </span>
          </div>
        )}

        {/* Speech bubble — absolute so it doesn't push card down */}
        {speechBubble && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 max-w-32 rounded-lg bg-white/95 border border-stone-200 px-2 py-1 shadow-sm z-10"
            data-kuma-agent-overlay="speech"
          >
            <p className="text-[8px] text-stone-600 leading-tight truncate">{speechBubble}</p>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/95 border-r border-b border-stone-200 rotate-45" />
          </div>
        )}
        {/* Status dot — outside card to avoid overflow clip */}
        <div
          className={`absolute -top-1 -right-1 z-10 h-3 w-3 rounded-full border-2 border-white shadow-sm ${isActive ? "animate-pulse" : ""}`}
          data-kuma-agent-overlay="status-dot"
          style={{ backgroundColor: stateColor }}
        />

        {/* Simplified card — near-square */}
        <div
          className={`character-card relative flex w-24 flex-col items-center rounded-xl border-2 pt-2 shadow-md backdrop-blur-sm ${
            character.state === "working"
              ? "border-blue-400/70 bg-blue-50/85 shadow-blue-300/40 ring-2 ring-blue-400/40 animate-state-glow"
              : character.state === "thinking"
              ? "border-amber-300/70 bg-amber-50/80 shadow-amber-200/40 ring-2 ring-amber-300/30 animate-state-glow"
              : character.state === "error"
              ? "border-red-300/70 bg-red-50/80 shadow-red-200/40 ring-2 ring-red-300/30 animate-error-shake"
              : character.state === "completed"
              ? "border-green-300/70 bg-green-50/80 shadow-green-200/40 animate-completion-pop"
              : character.state === "idle"
              ? "border-white/40 bg-white/80 animate-zzz"
              : "border-white/40 bg-white/80"
          } ${isSelected ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
          style={{
            "--glow-color": character.state === "working"
              ? "rgba(96, 165, 250, 0.3)"
              : character.state === "thinking"
              ? "rgba(245, 158, 11, 0.25)"
              : character.state === "error"
              ? "rgba(248, 113, 113, 0.3)"
              : undefined,
          } as React.CSSProperties}
        >

        {/* Avatar */}
        <CharacterSprite character={character} />

        {/* Working progress bar */}
        {isActive && (
          <div className="working-progress-bar mt-1.5 w-full" data-kuma-agent-overlay="progress" />
        )}

        {/* Name plate — compact */}
        <div className="character-name-plate mt-1.5 -mx-[2px] -mb-[2px] w-[calc(100%+4px)] rounded-b-[10px] px-1.5 py-1">
          <p className="text-[10px] font-bold text-amber-100 text-center truncate" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
            {displayName}
          </p>
          <p className="text-[8px] text-stone-300/80 text-center truncate">{displayRole}</p>
          {displayModel && (
            <p className="text-[7px] text-center truncate">
              <span className={`inline-block rounded-full px-1.5 py-px font-bold leading-tight ${
                (liveModelInfo?.model ?? model ?? "").includes("opus") ? "bg-indigo-200/60 text-indigo-700"
                : (liveModelInfo?.model ?? model ?? "").includes("sonnet") ? "bg-blue-200/60 text-blue-700"
                : (liveModelInfo?.model ?? model ?? "").startsWith("gpt") ? "bg-emerald-200/60 text-emerald-700"
                : "bg-stone-200/60 text-stone-500"
              }`}>
                {displayModel}
              </span>
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
