import { useState, type MouseEvent } from "react";
import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { CharacterSprite } from "./CharacterSprite";
import { CharacterTooltip } from "./CharacterTooltip";
import { useRandomEmote } from "../../hooks/use-random-emote";
import { STATE_COLORS, STATE_LABELS_KO } from "../../lib/constants";

interface CharacterProps {
  character: OfficeCharacter;
  isDragging?: boolean;
  isSelected?: boolean;
  speechBubble?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

function modelBadgeClass(model: string | undefined): string {
  if (!model) return "bg-stone-100 text-stone-400";
  if (model.includes("opus")) return "bg-indigo-100 text-indigo-600";
  if (model.includes("sonnet")) return "bg-blue-100 text-blue-600";
  if (model.includes("codex")) return "bg-emerald-100 text-emerald-700";
  return "bg-stone-100 text-stone-400";
}

function modelShortName(model: string | undefined): string | null {
  if (!model) return null;
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("codex")) return "codex";
  return model;
}

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
  const shortModel = modelShortName(model);
  const skills = teamMember?.skills ?? [];

  return (
    <div
      className={`absolute flex select-none flex-col items-center ${
        isDragging ? "z-20 cursor-grabbing" : "transition-all duration-500 ease-in-out cursor-grab"
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
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: stateColor }}
            title={stateLabel}
          />
          <span className="text-[8px] text-stone-400">{stateLabel}</span>
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

        {/* Name + emoji */}
        <p className="mt-1 text-xs font-bold text-stone-800">
          {displayEmoji} {displayName}
        </p>

        {/* Role */}
        <p className="text-[10px] text-stone-500">{displayRole}</p>

        {/* Model badge */}
        {shortModel && (
          <span className={`mt-1 inline-block rounded-full px-1.5 py-px text-[7px] font-semibold leading-tight ${modelBadgeClass(model)}`}>
            {shortModel}
          </span>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-center gap-0.5">
            {skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] text-amber-800"
              >
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
