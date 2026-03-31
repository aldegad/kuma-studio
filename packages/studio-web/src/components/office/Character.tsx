import type { MouseEvent } from "react";
import type { OfficeCharacter } from "../../types/office";
import { CharacterSprite } from "./CharacterSprite";
import { STATE_COLORS } from "../../lib/constants";

interface CharacterProps {
  character: OfficeCharacter;
  isDragging?: boolean;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
}

export function Character({ character, isDragging = false, onDragStart }: CharacterProps) {
  const stateColor = STATE_COLORS[character.state] ?? STATE_COLORS.idle;

  return (
    <div
      className={`absolute flex select-none flex-col items-center transition-all duration-500 ease-in-out ${
        isDragging ? "z-20 cursor-grabbing" : "cursor-grab"
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
        <p className="text-[10px] font-bold text-stone-800">{character.name}</p>
        <p className="text-[8px] text-stone-500">{character.role}</p>
      </div>

      {/* State indicator */}
      <div
        className="mt-0.5 h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: stateColor }}
      />
    </div>
  );
}
