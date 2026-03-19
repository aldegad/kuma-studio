"use client";

import {
  Download,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import KumaPickerCanvasNode from "./KumaPickerCanvasNode";
import { getSyncStateLabel } from "../lib/scene-daemon";
import { clampZoom } from "../lib/scene-layout";
import {
  getCanvasBounds,
  type KumaPickerComponentItem,
  type KumaPickerStudy,
  type KumaPickerSyncState,
  type KumaPickerViewport,
} from "../lib/types";

interface KumaPickerBoardProps {
  readOnly: boolean;
  studies: KumaPickerStudy[];
  selectedStudyId: string | null;
  zoom: number;
  copyState: "idle" | "copied";
  syncState: KumaPickerSyncState;
  lastSavedAt: string | null;
  getItem: (itemId: string) => KumaPickerComponentItem | undefined;
  onZoomChange: (value: number) => void;
  onToolbarHeightChange: (value: number) => void;
  onReloadScene: () => void;
  onSelectStudy: (studyId: string) => void;
  onClearSelection: () => void;
  onDropItem: (itemId: string, point?: { x: number; y: number }) => void;
  onBringToFront: (studyId: string) => void;
  onUpdateStudyPosition: (studyId: string, x: number, y: number) => void;
  onCommitStudyPosition: (studyId: string) => void;
  onViewportChange: (studyId: string, viewport: KumaPickerViewport) => void;
  onRemoveStudy: (studyId: string) => void;
  onClearBoard: () => void;
  onAutoArrange: () => void;
  onExportLayout: () => Promise<void>;
}

const ZOOM_MULTIPLIER = 1.25;

export default function KumaPickerBoard({
  readOnly,
  studies,
  selectedStudyId,
  zoom,
  copyState,
  syncState,
  lastSavedAt,
  getItem,
  onZoomChange,
  onToolbarHeightChange,
  onReloadScene,
  onSelectStudy,
  onClearSelection,
  onDropItem,
  onBringToFront,
  onUpdateStudyPosition,
  onCommitStudyPosition,
  onViewportChange,
  onRemoveStudy,
  onClearBoard,
  onAutoArrange,
  onExportLayout,
}: KumaPickerBoardProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const zoomFrameRef = useRef<number | null>(null);
  const touchPinchRef = useRef<{
    distance: number;
    startZoom: number;
    contentX: number;
    contentY: number;
  } | null>(null);
  const canvasBounds = getCanvasBounds(studies);
  const scaledCanvasWidth = Math.round(canvasBounds.width * zoom);
  const scaledCanvasHeight = Math.round(canvasBounds.height * zoom);
  const syncTone =
    syncState === "conflict"
      ? "border-[#ead6d2] bg-[#fff6f3] text-[#8b4e45]"
      : syncState === "offline"
        ? "border-[#e6ddd0] bg-[#fbf7ef] text-[#8a6c33]"
        : "border-[#e5e5e5] bg-white text-[#5e5e5e]";
  const syncTimestamp = lastSavedAt
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastSavedAt))
    : null;
  const stageStyle: CSSProperties & Record<"--kuma-picker-zoom", string> = {
    "--kuma-picker-zoom": String(zoom),
    width: canvasBounds.width,
    height: canvasBounds.height,
    backgroundImage:
      "radial-gradient(circle at 1px 1px, rgba(120,120,120,0.16) 1px, transparent 0)",
    backgroundSize: "24px 24px",
  };
  const zoomPercent = Math.round(zoom * 100);

  const handleZoomInput = (value: string) => {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return;
    onZoomChange(percent / 100);
  };

  const handleZoomStep = (direction: "in" | "out") => {
    const nextZoom = clampZoom(direction === "in" ? zoom * ZOOM_MULTIPLIER : zoom / ZOOM_MULTIPLIER);

    onZoomChange(nextZoom);
  };

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const readAnchorPoint = useCallback((clientX: number, clientY: number) => {
    const container = scrollContainerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const currentZoom = zoomRef.current || 1;

    return {
      localX,
      localY,
      contentX: (container.scrollLeft + localX) / currentZoom,
      contentY: (container.scrollTop + localY) / currentZoom,
    };
  }, []);

  const applyZoomAtAnchor = useCallback(
    (nextZoom: number, anchor: { contentX: number; contentY: number }, localPoint: { x: number; y: number }) => {
      const container = scrollContainerRef.current;
      if (!container) {
        zoomRef.current = nextZoom;
        onZoomChange(nextZoom);
        return;
      }

      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current);
      }

      zoomRef.current = nextZoom;
      onZoomChange(nextZoom);

      zoomFrameRef.current = requestAnimationFrame(() => {
        const currentContainer = scrollContainerRef.current;
        if (!currentContainer) return;

        currentContainer.scrollLeft = anchor.contentX * nextZoom - localPoint.x;
        currentContainer.scrollTop = anchor.contentY * nextZoom - localPoint.y;
        zoomFrameRef.current = null;
      });
    },
    [onZoomChange],
  );

  useEffect(
    () => () => {
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const updateHeight = () => {
      onToolbarHeightChange(toolbar.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [onToolbarHeightChange]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;

      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0025);
      const currentZoom = zoomRef.current;
      const nextZoom = clampZoom(currentZoom * factor);
      if (nextZoom === currentZoom) return;

      const anchorPoint = readAnchorPoint(event.clientX, event.clientY);
      if (!anchorPoint) return;

      applyZoomAtAnchor(
        nextZoom,
        { contentX: anchorPoint.contentX, contentY: anchorPoint.contentY },
        { x: anchorPoint.localX, y: anchorPoint.localY },
      );
    };

    const readTouchDistance = (touches: TouchList) => {
      const [first, second] = [touches[0], touches[1]];
      return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    };

    const readTouchCenter = (touches: TouchList) => {
      const [first, second] = [touches[0], touches[1]];
      return {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const center = readTouchCenter(event.touches);
      const anchorPoint = readAnchorPoint(center.x, center.y);
      if (!anchorPoint) return;

      touchPinchRef.current = {
        distance: readTouchDistance(event.touches),
        startZoom: zoomRef.current,
        contentX: anchorPoint.contentX,
        contentY: anchorPoint.contentY,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !touchPinchRef.current) return;

      event.preventDefault();
      const nextDistance = readTouchDistance(event.touches);
      const nextZoom = clampZoom((touchPinchRef.current.startZoom * nextDistance) / touchPinchRef.current.distance);
      const center = readTouchCenter(event.touches);
      const anchorPoint = readAnchorPoint(center.x, center.y);
      if (!anchorPoint) return;

      applyZoomAtAnchor(
        nextZoom,
        { contentX: touchPinchRef.current.contentX, contentY: touchPinchRef.current.contentY },
        { x: anchorPoint.localX, y: anchorPoint.localY },
      );
    };

    const resetTouchPinch = () => {
      if (touchPinchRef.current && (container as HTMLElement).ownerDocument) {
        touchPinchRef.current = null;
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", resetTouchPinch);
    container.addEventListener("touchcancel", resetTouchPinch);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", resetTouchPinch);
      container.removeEventListener("touchcancel", resetTouchPinch);
    };
  }, [applyZoomAtAnchor, readAnchorPoint]);

  return (
    <section className="relative flex min-h-[420px] min-w-0 overflow-hidden rounded-[2rem] border border-[#e7e7e7] bg-[#f6f6f6] sm:min-h-[520px] lg:h-full lg:min-h-0">
      <div className="flex flex-1 overflow-hidden bg-[#f6f6f6]">
        <div ref={scrollContainerRef} className="kuma-picker-scrollbar relative h-full w-full overflow-auto">
          <div className="pointer-events-none sticky left-0 top-0 z-20 h-0 overflow-visible">
            <div
              ref={toolbarRef}
              className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-[1.4rem] bg-white/92 p-2 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur"
            >
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={onAutoArrange}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[#ececec] bg-white px-4 py-3 text-sm font-medium text-[#171717]"
                >
                  <Sparkles className="h-4 w-4" />
                  Auto Arrange
                </button>
              )}

              {readOnly ? null : <div className="hidden h-10 w-px bg-[#ececec] sm:block" />}

              <button
                type="button"
                onClick={() => handleZoomStep("out")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#ececec] bg-white text-[#555]"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>

              <label className="flex h-11 min-w-[128px] items-center rounded-2xl border border-[#ececec] bg-white px-4 text-sm text-[#171717]">
                <input
                  type="number"
                  min={10}
                  max={1000}
                  step={10}
                  value={zoomPercent}
                  onChange={(event) => handleZoomInput(event.target.value)}
                  className="w-full bg-transparent text-center outline-none"
                  aria-label="Zoom percentage"
                />
                <span className="text-[#8b8b8b]">%</span>
              </label>

              <button
                type="button"
                onClick={() => handleZoomStep("in")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#ececec] bg-white text-[#555]"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => onZoomChange(1)}
                className="inline-flex items-center gap-2 rounded-2xl border border-[#ececec] bg-white px-4 py-3 text-sm text-[#555]"
              >
                <RotateCcw className="h-4 w-4" />
                Reset View
              </button>

              <div className={`rounded-full border px-3 py-1.5 text-xs ${syncTone} sm:ml-auto`}>
                <span className="font-medium">{getSyncStateLabel(syncState)}</span>
                {syncTimestamp ? <span className="ml-2 text-[11px] opacity-80">{syncTimestamp}</span> : null}
              </div>

              {readOnly ? null : (
                <>
                  <button
                    type="button"
                    onClick={onReloadScene}
                    className="inline-flex items-center gap-2 rounded-2xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm text-[#555]"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Reload
                  </button>

                  {studies.length > 0 ? (
                    <button
                      onClick={onClearBoard}
                      className="rounded-2xl border border-[#e5e5e5] bg-white px-4 py-2 text-sm text-[#555]"
                    >
                      Clear
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      void onExportLayout();
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl border border-[#dadada] bg-[#efefef] px-5 py-3 text-sm font-medium text-[#171717]"
                  >
                    <Download className="h-4 w-4" />
                    {copyState === "copied" ? "Copied" : "Export"}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="relative pb-5">
            <div className="shrink-0" style={{ width: scaledCanvasWidth, height: scaledCanvasHeight }}>
              <div
                ref={stageRef}
                onClick={readOnly ? undefined : onClearSelection}
                onDragOver={
                  readOnly
                    ? undefined
                    : (event) => {
                        event.preventDefault();
                      }
                }
                onDrop={
                  readOnly
                    ? undefined
                    : (event) => {
                        event.preventDefault();
                        const itemId = event.dataTransfer.getData("text/kuma-picker-item");
                        if (!itemId || !stageRef.current) return;

                        const rect = stageRef.current.getBoundingClientRect();
                        onDropItem(itemId, {
                          x: (event.clientX - rect.left) / zoom,
                          y: (event.clientY - rect.top) / zoom,
                        });
                      }
                }
                className="kuma-picker-stage relative"
                style={stageStyle}
              >
                {studies.length === 0 ? (
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="rounded-[1.6rem] border border-dashed border-[#d9d9d9] bg-white/70 px-8 py-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <p className="text-lg font-medium text-[#171717]">
                        {readOnly ? "Local daemon required" : "Drag components into the canvas"}
                      </p>
                      <p className="mt-2 text-sm text-[#8b8b8b]">
                        {readOnly
                          ? "Run the local daemon to load and edit this design lab."
                          : "Move them around freely and compare directions."}
                      </p>
                    </div>
                  </div>
                ) : null}

                {studies.map((study) => {
                  const item = getItem(study.itemId);
                  if (!item) return null;

                  return (
                    <KumaPickerCanvasNode
                      key={study.id}
                      study={study}
                      item={item}
                      zoom={zoom}
                      readOnly={readOnly}
                      selected={study.id === selectedStudyId}
                      onSelect={onSelectStudy}
                      onBringToFront={onBringToFront}
                      onPositionChange={onUpdateStudyPosition}
                      onPositionCommit={onCommitStudyPosition}
                      onViewportChange={onViewportChange}
                      onRemove={onRemoveStudy}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
