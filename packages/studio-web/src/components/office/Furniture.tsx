import { type MouseEvent } from "react";
import type { OfficeFurniture } from "../../types/office";
import { FURNITURE_SIZES } from "../../lib/office-scene";

interface FurnitureProps {
  furniture: OfficeFurniture;
  isDragging?: boolean;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
}

const FURNITURE_IMAGES: Record<string, string> = {
  desk: "/assets/furniture/desk.png",
  whiteboard: "/assets/furniture/whiteboard.png",
  plant: "/assets/furniture/plant.png",
  coffee: "/assets/furniture/coffee.png",
  chair: "/assets/furniture/chair.png",
};

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

  const imgSrc = FURNITURE_IMAGES[furniture.type];

  return (
    <div
      className={`absolute select-none ${isDragging ? "z-20 cursor-grabbing" : "cursor-grab"} transition-transform duration-200 hover:scale-110`}
      onMouseDown={onDragStart}
      style={{
        left: furniture.position.x,
        top: furniture.position.y,
        width: size.w,
        height: size.h,
        transform: "translate(-50%, -50%)",
        filter: "drop-shadow(2px 3px 4px rgba(0,0,0,0.2))",
      }}
    >
      {imgSrc ? (
        <img src={imgSrc} alt={furniture.type} className="w-full h-full object-contain pointer-events-none" draggable={false} />
      ) : (
        <div className="flex h-full items-center justify-center rounded border border-amber-300/40 bg-amber-200/30 text-xs text-amber-600/60">
          {furniture.type}
        </div>
      )}
    </div>
  );
}
