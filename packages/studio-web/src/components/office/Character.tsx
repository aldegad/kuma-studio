import type { MouseEvent } from "react";
import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { CharacterSprite } from "./CharacterSprite";
import { STATE_COLORS, STATE_LABELS_KO } from "../../lib/constants";

interface CharacterProps {
  character: OfficeCharacter;
  isDragging?: boolean;
  speechBubble?: string;
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

export function Character({ character, isDragging = false, speechBubble, onDragStart, onDoubleClick }: CharacterProps) {
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
      onDoubleClick={onDoubleClick}
      style={{
        left: character.position.x,
        top: character.position.y,
        transform: "translate(-50%, -50%)",
        animation: isDragging ? "none" : `float-idle ${2.5 + (character.id.charCodeAt(0) % 5) * 0.3}s ease-in-out infinite`,
      }}
    >
      {/* Speech bubble */}
      {speechBubble && (
        <div className="mb-1 max-w-32 rounded-lg bg-white/95 border border-stone-200 px-2 py-1 shadow-sm relative">
          <p className="text-[8px] text-stone-600 leading-tight truncate">{speechBubble}</p>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/95 border-r border-b border-stone-200 rotate-45" />
        </div>
      )}

      {/* Card container — glow based on state */}
      <div className={`flex w-30 flex-col items-center rounded-xl border p-2 shadow-md backdrop-blur-sm hover:shadow-lg transition-shadow duration-200 ${
        character.state === "working" || character.state === "thinking"
          ? "border-blue-300 bg-blue-50/80 shadow-blue-200/50 ring-2 ring-blue-300/40"
          : character.state === "error"
          ? "border-red-300 bg-red-50/80 shadow-red-200/50 ring-2 ring-red-300/40"
          : character.state === "completed"
          ? "border-green-300 bg-green-50/80 shadow-green-200/50"
          : "border-white/50 bg-white/80 hover:bg-white/90"
      }`}>
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
