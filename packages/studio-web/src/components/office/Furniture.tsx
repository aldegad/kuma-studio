import type { MouseEvent } from "react";
import type { OfficeFurniture } from "../../types/office";
import { FURNITURE_SIZES } from "../../lib/office-scene";

interface FurnitureProps {
  furniture: OfficeFurniture;
  isDragging?: boolean;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
}

export function Furniture({ furniture, isDragging = false, onDragStart }: FurnitureProps) {
  const size = FURNITURE_SIZES[furniture.type] ?? { w: 40, h: 40 };

  if (furniture.imageUrl) {
    return (
      <div
        className={`absolute select-none ${isDragging ? "z-20 cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={onDragStart}
        style={{
          left: furniture.position.x,
          top: furniture.position.y,
          width: size.w,
          height: size.h,
          transform: "translate(-50%, -50%)",
        }}
      >
        <img src={furniture.imageUrl} alt={furniture.type} className="h-full w-full object-contain" />
      </div>
    );
  }

  // Placeholder furniture rendering
  return (
    <div
      className={`absolute select-none rounded border border-amber-300/40 bg-amber-200/30 ${
        isDragging ? "z-20 cursor-grabbing" : "cursor-grab"
      }`}
      onMouseDown={onDragStart}
      style={{
        left: furniture.position.x,
        top: furniture.position.y,
        width: size.w,
        height: size.h,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="flex h-full items-center justify-center text-xs text-amber-600/60">
        {furniture.type}
      </div>
    </div>
  );
}
