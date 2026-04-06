import { useCallback, useEffect, useState, type RefObject } from "react";
import { useOfficeStore } from "../stores/use-office-store";
import { useWsStore } from "../stores/use-ws-store";
import { FURNITURE_SIZES, sceneToLayout, TEAM_ZONES } from "../lib/office-scene";
import { saveOfficeLayout } from "../lib/api";
import type { OfficePosition } from "../types/office";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DragState =
  | { kind: "character"; id: string; offsetX: number; offsetY: number }
  | { kind: "furniture"; id: string; offsetX: number; offsetY: number }
  | { kind: "pan"; startX: number; startY: number; startPanX: number; startPanY: number };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CANVAS_WIDTH = 2000;
export const CANVAS_HEIGHT = 1500;
export const ZOOM_DEFAULT = 0.7;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2.0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readStoredNumber(key: string, fallback: number, min?: number, max?: number) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (min != null || max != null) return clamp(parsed, min ?? parsed, max ?? parsed);
  return parsed;
}

function clampPosition(
  kind: "character" | "furniture",
  id: string,
  position: OfficePosition,
  width: number,
  height: number,
): OfficePosition {
  const bounds =
    kind === "character"
      ? { halfWidth: 30, halfHeight: 30 }
      : (() => {
          const furniture = useOfficeStore.getState().scene.furniture.find((item) => item.id === id);
          const size = FURNITURE_SIZES[furniture?.type ?? ""] ?? { w: 40, h: 40 };
          return { halfWidth: size.w / 2, halfHeight: size.h / 2 };
        })();
  return {
    x: clamp(position.x, bounds.halfWidth, Math.max(width - bounds.halfWidth, bounds.halfWidth)),
    y: clamp(position.y, bounds.halfHeight, Math.max(height - bounds.halfHeight, bounds.halfHeight)),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCanvasInteraction(containerRef: RefObject<HTMLDivElement | null>) {
  const send = useWsStore((s) => s.send);
  const updateCharacterPosition = useOfficeStore((s) => s.updateCharacterPosition);
  const updateFurniturePosition = useOfficeStore((s) => s.updateFurniturePosition);
  const markDragged = useOfficeStore((s) => s.markDragged);
  const scene = useOfficeStore((s) => s.scene);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [zoom, setZoom] = useState(() => readStoredNumber("kuma-studio-zoom", ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX));
  const [panX, setPanX] = useState(() => readStoredNumber("kuma-studio-panX", 0));
  const [panY, setPanY] = useState(() => readStoredNumber("kuma-studio-panY", 0));

  // Persist zoom/pan
  useEffect(() => {
    localStorage.setItem("kuma-studio-zoom", String(zoom));
    localStorage.setItem("kuma-studio-panX", String(panX));
    localStorage.setItem("kuma-studio-panY", String(panY));
  }, [zoom, panX, panY]);

  // Drag logic
  useEffect(() => {
    if (!dragState) return;
    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (dragState.kind === "pan") {
        setPanX(dragState.startPanX + (e.clientX - dragState.startX));
        setPanY(dragState.startPanY + (e.clientY - dragState.startY));
        return;
      }
      const rect = container.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - panX) / zoom - dragState.offsetX;
      const canvasY = (e.clientY - rect.top - panY) / zoom - dragState.offsetY;
      const position = clampPosition(dragState.kind, dragState.id, { x: canvasX, y: canvasY }, CANVAS_WIDTH, CANVAS_HEIGHT);
      if (dragState.kind === "character") {
        updateCharacterPosition(dragState.id, position);
        markDragged(dragState.id);
      } else {
        updateFurniturePosition(dragState.id, position);
      }
      send({ type: "kuma-studio:layout-update", layout: sceneToLayout(useOfficeStore.getState().scene) });
    };
    const handleMouseUp = () => {
      const wasPan = dragState.kind === "pan";
      setDragState(null);
      if (!wasPan) {
        const currentScene = useOfficeStore.getState().scene;
        void saveOfficeLayout(sceneToLayout(currentScene)).catch(() => {});
        // Persist positions to localStorage for reload survival
        if (dragState.kind === "character") {
          try {
            const stored = JSON.parse(localStorage.getItem("kuma-office-character-positions") || "{}");
            const char = currentScene.characters.find((c) => c.id === dragState.id);
            if (char) {
              stored[dragState.id] = char.position;
              localStorage.setItem("kuma-office-character-positions", JSON.stringify(stored));
            }
          } catch { /* ignore */ }
        } else if (dragState.kind === "furniture") {
          try {
            const stored = JSON.parse(localStorage.getItem("kuma-office-furniture-positions") || "{}");
            const item = currentScene.furniture.find((f) => f.id === dragState.id);
            if (item) {
              stored[dragState.id] = item.position;
              localStorage.setItem("kuma-office-furniture-positions", JSON.stringify(stored));
            }
          } catch { /* ignore */ }
        }
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, zoom, panX, panY, send, updateCharacterPosition, updateFurniturePosition, markDragged, containerRef]);

  // Wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = clamp(zoom * zoomFactor, ZOOM_MIN, ZOOM_MAX);
      setPanX(mouseX - (mouseX - panX) * (newZoom / zoom));
      setPanY(mouseY - (mouseY - panY) * (newZoom / zoom));
      setZoom(newZoom);
    },
    [zoom, panX, panY, containerRef],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel, containerRef]);

  // Fit to screen
  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const positions = scene.characters.map((c) => c.position);
    if (positions.length === 0) return;
    const PAD = 80;
    const minX = Math.min(...positions.map((p) => p.x)) - PAD;
    const minY = Math.min(...positions.map((p) => p.y)) - PAD;
    const maxX = Math.max(...positions.map((p) => p.x)) + PAD;
    const maxY = Math.max(...positions.map((p) => p.y)) + PAD;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const viewW = container.clientWidth;
    const viewH = container.clientHeight;
    const newZoom = clamp(Math.min(viewW / contentW, viewH / contentH), ZOOM_MIN, ZOOM_MAX);
    setZoom(newZoom);
    setPanX((viewW - contentW * newZoom) / 2 - minX * newZoom);
    setPanY((viewH - contentH * newZoom) / 2 - minY * newZoom);
  }, [scene.characters, containerRef]);

  // Focus on zone
  const focusOnZone = useCallback((zoneIndex: number) => {
    const zone = TEAM_ZONES[zoneIndex];
    if (!zone) return;
    const container = containerRef.current;
    if (!container) return;
    const focusZoom = 1.4;
    const cx = zone.x + zone.w / 2;
    const cy = zone.y + zone.h / 2;
    setZoom(focusZoom);
    setPanX(container.clientWidth / 2 - cx * focusZoom);
    setPanY(container.clientHeight / 2 - cy * focusZoom);
  }, [containerRef]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); return; }
      if (e.key === "Escape") return;
      const PAN_STEP = 80;
      if (e.key === "ArrowLeft") { e.preventDefault(); setPanX((v) => v + PAN_STEP); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); setPanX((v) => v - PAN_STEP); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setPanY((v) => v + PAN_STEP); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setPanY((v) => v - PAN_STEP); return; }
      if (e.key === "f" && !e.ctrlKey && !e.metaKey) { fitToScreen(); return; }
      if (!e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "4") { focusOnZone(Number(e.key) - 1); return; }
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); setZoom((z) => clamp(z * 1.2, ZOOM_MIN, ZOOM_MAX)); }
      else if (e.key === "-") { e.preventDefault(); setZoom((z) => clamp(z / 1.2, ZOOM_MIN, ZOOM_MAX)); }
      else if (e.key === "0") { e.preventDefault(); setZoom(ZOOM_DEFAULT); setPanX(0); setPanY(0); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitToScreen, focusOnZone]);

  // Pan start handler
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setDragState({ kind: "pan", startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY });
    },
    [panX, panY],
  );

  return {
    dragState,
    setDragState,
    zoom,
    setZoom,
    panX,
    panY,
    fitToScreen,
    handleCanvasMouseDown,
  };
}
