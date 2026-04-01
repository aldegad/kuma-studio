import type { MouseEvent } from "react";
import type { OfficeCharacter } from "../../types/office";
import { KUMA_TEAM } from "../../types/agent";
import { CharacterSprite } from "./CharacterSprite";
import { STATE_COLORS, STATE_LABELS_KO } from "../../lib/constants";

interface CharacterProps {
  character: OfficeCharacter;
  isDragging?: boolean;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
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

export function Character({ character, isDragging = false, onDragStart }: CharacterProps) {
  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  const stateLabel = STATE_LABELS_KO[character.state] ?? character.state;
  const teamMember = KUMA_TEAM.find((m) => m.id === character.id);
  const displayName = teamMember?.nameKo ?? character.name;
  const displayRole = teamMember?.roleKo ?? character.role;
  const model = teamMember?.model;
  const shortModel = modelShortName(model);

  return (
    <div
      className={`absolute flex select-none flex-col items-center ${
        isDragging ? "z-20 cursor-grabbing" : "transition-all duration-500 ease-in-out cursor-grab"
      }`}
      onMouseDown={onDragStart}
      style={{
        left: character.position.x,
        top: character.position.y,
        transform: "translate(-50%, -50%)",
      }}
    >
      <CharacterSprite character={character} />

      {/* Name tag */}
      <div className="mt-1 rounded-full bg-white/90 px-2 py-0.5 text-center shadow-sm backdrop-blur-sm">
        <p className="text-[10px] font-bold text-stone-800">{displayName}</p>
        <p className="text-[8px] text-stone-500">{displayRole}</p>
        {shortModel && (
          <span className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[7px] font-semibold leading-tight ${modelBadgeClass(model)}`}>
            {shortModel}
          </span>
        )}
      </div>

      {/* State indicator */}
      <div
        className="mt-0.5 h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: stateColor }}
        title={stateLabel}
      />
    </div>
  );
}
