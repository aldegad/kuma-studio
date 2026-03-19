"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { Component, Monitor, Smartphone, Trash2 } from "lucide-react";
import KumaPickerPreview from "./KumaPickerPreview";
import {
  clampCanvasPosition,
  kumaPickerViewports,
  kumaPickerViewportList,
  type KumaPickerComponentItem,
  type KumaPickerStudy,
  type KumaPickerViewport,
} from "../lib/types";

interface KumaPickerCanvasNodeProps {
  study: KumaPickerStudy;
  item: KumaPickerComponentItem;
  zoom: number;
  readOnly: boolean;
  selected: boolean;
  onSelect: (studyId: string) => void;
  onBringToFront: (studyId: string) => void;
  onPositionChange: (studyId: string, x: number, y: number) => void;
  onPositionCommit: (studyId: string) => void;
  onViewportChange: (studyId: string, viewport: KumaPickerViewport) => void;
  onRemove: (studyId: string) => void;
}

export default function KumaPickerCanvasNode({
  study,
  item,
  zoom,
  readOnly,
  selected,
  onSelect,
  onBringToFront,
  onPositionChange,
  onPositionCommit,
  onViewportChange,
  onRemove,
}: KumaPickerCanvasNodeProps) {
  const config = kumaPickerViewports[study.viewport];
  const availableViewports = kumaPickerViewportList;
  const isLocked = Boolean(study.locked);
  const viewportIcons = {
    mobile: Smartphone,
    desktop: Monitor,
    original: Component,
  } satisfies Record<KumaPickerViewport, typeof Smartphone>;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isLocked || readOnly) return;

    event.preventDefault();
    event.stopPropagation();
    onSelect(study.id);
    onBringToFront(study.id);

    const startX = event.clientX;
    const startY = event.clientY;
    const originX = study.x;
    const originY = study.y;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const next = clampCanvasPosition(
        study.viewport,
        originX + (moveEvent.clientX - startX) / zoom,
        originY + (moveEvent.clientY - startY) / zoom,
      );
      onPositionChange(study.id, next.x, next.y);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      onPositionCommit(study.id);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <article
      onPointerDown={(event) => {
        if (readOnly) return;
        event.stopPropagation();
        onSelect(study.id);
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      className="group absolute"
      style={{
        width: config.nodeWidth,
        height: config.nodeHeight,
        zIndex: study.zIndex,
        transform: `translate(${study.x}px, ${study.y}px)`,
        willChange: "transform",
      }}
    >
      <div
        onPointerDown={handlePointerDown}
        className={`relative h-full w-full select-none ${isLocked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      >
        <div
          className={`pointer-events-none absolute inset-0 rounded-[1.85rem] transition-[border-color,box-shadow,background-color] ${
            selected
              ? "border border-[#25C69C] bg-transparent shadow-[0_20px_54px_rgba(37,198,156,0.2)]"
              : "border border-transparent bg-transparent shadow-none"
          }`}
        />

        <div className="absolute left-3 top-3 z-20 max-w-[calc(100%-6rem)]">
          <div
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium tracking-[-0.01em] backdrop-blur transition ${
              selected
                ? "bg-[rgba(37,198,156,0.14)] text-[#178764] shadow-[0_6px_18px_rgba(37,198,156,0.12)]"
                : "bg-white/88 text-[#3c4a50] shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
            }`}
          >
            <span className="block truncate">{study.title}</span>
          </div>
        </div>

        <div
          className={`absolute right-3 top-3 z-20 flex items-center gap-2 transition-opacity ${
            readOnly ? "hidden" : selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          <div
            className="relative grid h-8 rounded-full bg-white/92 p-1 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur"
            style={{
              width: `${availableViewports.length * 28 + 10}px`,
              gridTemplateColumns: `repeat(${availableViewports.length}, minmax(0, 1fr))`,
            }}
          >
            <div
              className="absolute inset-y-1 left-1 rounded-full bg-[#f3fffb] shadow-[0_4px_10px_rgba(37,198,156,0.12)] transition-transform duration-200"
              style={{
                width: `calc((100% - 0.5rem) / ${availableViewports.length})`,
                transform: `translateX(${availableViewports.findIndex((viewport) => viewport.key === study.viewport) * 100}%)`,
              }}
            />
            {availableViewports.map((viewport) => {
              const Icon = viewportIcons[viewport.key];
              const active = study.viewport === viewport.key;

              return (
                <button
                  key={viewport.key}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isLocked) return;
                    onViewportChange(study.id, viewport.key);
                  }}
                  className={`relative z-10 inline-flex h-6 items-center justify-center rounded-full transition ${
                    active ? "text-[#178764]" : "text-[#8b8b8b]"
                  }`}
                  aria-label={viewport.label}
                  title={viewport.label}
                  disabled={isLocked}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (isLocked) return;
              onRemove(study.id);
            }}
            className={`grid h-8 w-8 place-items-center rounded-full bg-white/92 text-[#8b8b8b] shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur ${
              isLocked ? "opacity-40" : ""
            }`}
            aria-label="Remove study"
            disabled={isLocked}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="h-full w-full">
          <KumaPickerPreview item={item} viewport={study.viewport} propsPatch={study.propsPatch} />
        </div>
      </div>
    </article>
  );
}
