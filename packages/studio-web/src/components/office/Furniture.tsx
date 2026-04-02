import { type MouseEvent } from "react";
import type { OfficeFurniture } from "../../types/office";
import { FURNITURE_SIZES } from "../../lib/office-scene";

interface FurnitureProps {
  furniture: OfficeFurniture;
  isDragging?: boolean;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
}

const BASE = import.meta.env.BASE_URL;

const FURNITURE_IMAGES: Record<string, string> = {
  desk: `${BASE}assets/furniture/desk.png`,
  whiteboard: `${BASE}assets/furniture/whiteboard.png`,
  plant: `${BASE}assets/furniture/plant.png`,
  coffee: `${BASE}assets/furniture/coffee.png`,
  chair: `${BASE}assets/furniture/chair.png`,
  bookshelf: `${BASE}assets/furniture/bookshelf.png`,
  sofa: `${BASE}assets/furniture/sofa.png`,
  printer: `${BASE}assets/furniture/printer.png`,
  watercooler: `${BASE}assets/furniture/watercooler.png`,
};

const FURNITURE_LABELS: Record<string, string> = {
  desk: "업무 데스크",
  whiteboard: "화이트보드",
  plant: "화분",
  coffee: "커피 스테이션",
  chair: "의자",
  bookshelf: "책장",
  sofa: "휴게 소파",
  printer: "복합기",
  watercooler: "정수기",
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

  const label = FURNITURE_LABELS[furniture.type] ?? furniture.type;

  return (
    <div
      className={`absolute select-none group ${isDragging ? "z-20 cursor-grabbing" : "cursor-grab"} transition-transform duration-200 hover:scale-110`}
      onMouseDown={onDragStart}
      title={label}
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
        <img src={imgSrc} alt={label} className="w-full h-full object-contain pointer-events-none" draggable={false} />
      ) : (
        <div className="flex h-full items-center justify-center rounded border border-amber-300/40 bg-amber-200/30 text-xs text-amber-600/60">
          {furniture.type}
        </div>
      )}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-stone-800/90 px-2 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {label}
      </div>
    </div>
  );
}
