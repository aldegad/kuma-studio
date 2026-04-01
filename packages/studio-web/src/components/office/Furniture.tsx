import React, { type MouseEvent } from "react";
import type { OfficeFurniture } from "../../types/office";
import { FURNITURE_SIZES } from "../../lib/office-scene";

interface FurnitureProps {
  furniture: OfficeFurniture;
  isDragging?: boolean;
  onDragStart?: (event: MouseEvent<HTMLDivElement>) => void;
}

function DeskSvg() {
  return (
    <svg viewBox="0 0 80 50" className="w-full h-full">
      {/* Desktop surface */}
      <rect x="4" y="8" width="72" height="6" rx="2" fill="#b8860b" />
      <rect x="4" y="8" width="72" height="3" rx="2" fill="#d4a435" />
      {/* Legs */}
      <rect x="8" y="14" width="4" height="28" rx="1" fill="#8b6914" />
      <rect x="68" y="14" width="4" height="28" rx="1" fill="#8b6914" />
      {/* Drawer */}
      <rect x="24" y="14" width="32" height="14" rx="2" fill="#c9952b" />
      <rect x="36" y="19" width="8" height="2" rx="1" fill="#a07818" />
      {/* Monitor */}
      <rect x="28" y="0" width="24" height="8" rx="1" fill="#374151" />
      <rect x="30" y="1" width="20" height="5" rx="0.5" fill="#60a5fa" opacity="0.6" />
      <rect x="38" y="7" width="4" height="2" fill="#6b7280" />
    </svg>
  );
}

function WhiteboardSvg() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full">
      {/* Board frame */}
      <rect x="4" y="4" width="72" height="44" rx="3" fill="#f5f5f4" stroke="#d6d3d1" strokeWidth="2" />
      {/* Content lines */}
      <line x1="12" y1="14" x2="50" y2="14" stroke="#93c5fd" strokeWidth="1.5" />
      <line x1="12" y1="22" x2="64" y2="22" stroke="#93c5fd" strokeWidth="1.5" />
      <line x1="12" y1="30" x2="40" y2="30" stroke="#fdba74" strokeWidth="1.5" />
      <line x1="12" y1="38" x2="56" y2="38" stroke="#86efac" strokeWidth="1.5" />
      {/* Markers */}
      <rect x="58" y="8" width="3" height="10" rx="1" fill="#ef4444" />
      <rect x="63" y="8" width="3" height="10" rx="1" fill="#3b82f6" />
      <rect x="68" y="8" width="3" height="10" rx="1" fill="#22c55e" />
      {/* Stand */}
      <rect x="36" y="48" width="8" height="4" rx="1" fill="#a8a29e" />
      <rect x="34" y="52" width="12" height="2" rx="1" fill="#a8a29e" />
    </svg>
  );
}

function PlantSvg() {
  return (
    <svg viewBox="0 0 32 40" className="w-full h-full">
      {/* Pot */}
      <path d="M8 26 L10 36 L22 36 L24 26 Z" fill="#d97706" />
      <rect x="6" y="24" width="20" height="4" rx="2" fill="#f59e0b" />
      {/* Leaves */}
      <ellipse cx="16" cy="16" rx="6" ry="8" fill="#22c55e" />
      <ellipse cx="10" cy="18" rx="5" ry="6" fill="#16a34a" transform="rotate(-20 10 18)" />
      <ellipse cx="22" cy="18" rx="5" ry="6" fill="#16a34a" transform="rotate(20 22 18)" />
      <ellipse cx="16" cy="10" rx="4" ry="6" fill="#4ade80" />
      {/* Stem */}
      <line x1="16" y1="22" x2="16" y2="26" stroke="#15803d" strokeWidth="2" />
    </svg>
  );
}

function CoffeeSvg() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      {/* Cup */}
      <path d="M4 8 L6 20 L16 20 L18 8 Z" fill="#fef3c7" stroke="#d97706" strokeWidth="1" />
      {/* Handle */}
      <path d="M18 10 Q22 10 22 14 Q22 18 18 18" fill="none" stroke="#d97706" strokeWidth="1.5" />
      {/* Coffee */}
      <ellipse cx="11" cy="9" rx="7" ry="2" fill="#92400e" />
      {/* Steam */}
      <path d="M8 4 Q9 2 8 0" fill="none" stroke="#d6d3d1" strokeWidth="0.8" opacity="0.6" />
      <path d="M12 3 Q13 1 12 -1" fill="none" stroke="#d6d3d1" strokeWidth="0.8" opacity="0.6" />
    </svg>
  );
}

function ChairSvg() {
  return (
    <svg viewBox="0 0 32 36" className="w-full h-full">
      {/* Seat */}
      <rect x="4" y="14" width="24" height="4" rx="2" fill="#78716c" />
      {/* Back */}
      <rect x="4" y="2" width="24" height="14" rx="3" fill="#57534e" />
      <rect x="8" y="4" width="16" height="10" rx="2" fill="#78716c" />
      {/* Legs */}
      <line x1="8" y1="18" x2="6" y2="30" stroke="#44403c" strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="18" x2="26" y2="30" stroke="#44403c" strokeWidth="2" strokeLinecap="round" />
      {/* Wheels */}
      <circle cx="6" cy="32" r="2" fill="#44403c" />
      <circle cx="26" cy="32" r="2" fill="#44403c" />
    </svg>
  );
}

const FURNITURE_SVG: Record<string, () => React.ReactNode> = {
  desk: DeskSvg,
  whiteboard: WhiteboardSvg,
  plant: PlantSvg,
  coffee: CoffeeSvg,
  chair: ChairSvg,
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

  const SvgComponent = FURNITURE_SVG[furniture.type];

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
        filter: "drop-shadow(1px 2px 2px rgba(0,0,0,0.15))",
      }}
    >
      {SvgComponent ? <SvgComponent /> : (
        <div className="flex h-full items-center justify-center rounded border border-amber-300/40 bg-amber-200/30 text-xs text-amber-600/60">
          {furniture.type}
        </div>
      )}
    </div>
  );
}
