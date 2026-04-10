import { type MouseEvent } from "react";
import type { OfficeFurniture } from "../../types/office";
import { FURNITURE_SIZES, SOFA_TEAM_LABELS, DESK_MEMBER_INFO } from "../../lib/office-scene";

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
      className={`office-furniture absolute select-none group ${isDragging ? "z-20 cursor-grabbing" : "cursor-grab"} transition-[transform,filter] duration-200 hover:scale-110`}
      onMouseDown={onDragStart}
      title={label}
      style={{
        left: furniture.position.x,
        top: furniture.position.y,
        width: size.w,
        height: size.h,
        transform: "translate(-50%, -50%)",
        filter: isDragging ? "drop-shadow(2px 4px 6px rgba(0,0,0,0.3))" : undefined,
      }}
    >
      {/* Ground shadow ellipse — only visible on hover/drag */}
      <div
        className={`absolute pointer-events-none transition-opacity duration-200 ${isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        style={{
          left: "10%",
          right: "10%",
          bottom: "2%",
          height: "12%",
          background: "radial-gradient(ellipse, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.06) 50%, transparent 70%)",
          borderRadius: "50%",
        }}
      />
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={label}
          className="w-full h-full object-contain pointer-events-none relative"
          draggable={false}
          style={{
            /* Remove internal transparency — make sprite opaque where it has content */
            imageRendering: "auto",
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center rounded border border-amber-300/40 bg-amber-200/30 text-xs text-amber-600/60">
          {furniture.type}
        </div>
      )}
      {/* Hover tooltip (non-desk/sofa only — desks and sofas have permanent labels) */}
      {furniture.type !== "desk" && furniture.type !== "sofa" && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-stone-800/90 px-2 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          {label}
        </div>
      )}
      {/* Desk name plate — shows character emoji, name, and team */}
      {furniture.type === "desk" && furniture.id.startsWith("desk-") && (() => {
        const memberId = furniture.id.replace("desk-", "");
        const info = DESK_MEMBER_INFO[memberId];
        if (!info) return null;
        return (
          <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none select-none">
            <div
              className="flex flex-col items-center rounded-md px-2.5 py-1"
              style={{
                background: "linear-gradient(180deg, rgba(160, 120, 60, 0.88) 0%, rgba(120, 85, 40, 0.92) 100%)",
                border: "1px solid rgba(200, 170, 110, 0.45)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,220,150,0.18)",
              }}
            >
              <span
                className="text-[10px] font-bold text-amber-50 leading-tight"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
              >
                {info.emoji} {info.name}
              </span>
              <span className="text-[8px] font-medium text-amber-200/65 leading-tight">
                {info.teamName}
              </span>
            </div>
          </div>
        );
      })()}
      {/* Team label on sofas — Korean team name + 휴게 */}
      {furniture.type === "sofa" && furniture.id.startsWith("sofa-") && (() => {
        const teamId = furniture.id.replace("sofa-", "");
        const teamLabel = SOFA_TEAM_LABELS[teamId];
        if (!teamLabel) return null;
        const teamColorMap: Record<string, { bg: string; text: string; border: string }> = {
          dev: { bg: "rgba(59, 130, 246, 0.12)", text: "rgba(59, 130, 246, 0.75)", border: "rgba(59, 130, 246, 0.2)" },
          analytics: { bg: "rgba(249, 115, 22, 0.12)", text: "rgba(249, 115, 22, 0.75)", border: "rgba(249, 115, 22, 0.2)" },
          strategy: { bg: "rgba(34, 197, 94, 0.12)", text: "rgba(34, 197, 94, 0.75)", border: "rgba(34, 197, 94, 0.2)" },
        };
        const colors = teamColorMap[teamId] ?? { bg: "rgba(120,113,108,0.1)", text: "rgba(120,113,108,0.6)", border: "rgba(120,113,108,0.15)" };
        return (
          <div
            className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none select-none rounded-full px-2.5 py-0.5"
            style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
          >
            <span
              className="text-[9px] font-bold tracking-wide"
              style={{ color: colors.text }}
            >
              {teamLabel}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
