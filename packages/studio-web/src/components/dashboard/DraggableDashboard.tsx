import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { FloatingPanel } from "./SortablePanel";

const DASHBOARD_POSITIONS_KEY = "kuma-studio-panel-positions";
const DEFAULT_PANEL_X = 16;
const DEFAULT_PANEL_Y = 56;
const DEFAULT_PANEL_VERTICAL_STEP = 148;
const DRAG_THRESHOLD_PX = 4;

export interface PanelPosition {
  x: number;
  y: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

type DefaultPanelPosition =
  | PanelPosition
  | ((viewport: ViewportSize, index: number) => PanelPosition);

export interface DashboardPanelItem {
  id: string;
  title: string;
  content: ReactNode;
  hidden?: boolean;
  className?: string;
  defaultPosition?: DefaultPanelPosition;
}

interface DragSession {
  id: string;
  startClientX: number;
  startClientY: number;
  offsetX: number;
  offsetY: number;
  hasMoved: boolean;
}

function isPanelPosition(value: unknown): value is PanelPosition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PanelPosition>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function readStoredPositions(storageKey: string): Record<string, PanelPosition> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const nextPositions: Record<string, PanelPosition> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && isPanelPosition(value)) {
        nextPositions[key] = { x: value.x, y: value.y };
      }
    }

    return nextPositions;
  } catch {
    return {};
  }
}

function writeStoredPositions(storageKey: string, positions: Record<string, PanelPosition>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(positions));
}

function getDefaultPosition(index: number): PanelPosition {
  return {
    x: DEFAULT_PANEL_X,
    y: DEFAULT_PANEL_Y + index * DEFAULT_PANEL_VERTICAL_STEP,
  };
}

function getViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { width: 1440, height: 900 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function resolveDefaultPosition(
  panel: DashboardPanelItem,
  index: number,
): PanelPosition {
  if (!panel.defaultPosition) {
    return getDefaultPosition(index);
  }

  if (typeof panel.defaultPosition === "function") {
    return panel.defaultPosition(getViewportSize(), index);
  }

  return panel.defaultPosition;
}

function reconcilePositions(
  storedPositions: Record<string, PanelPosition>,
  visiblePanels: DashboardPanelItem[],
) {
  const nextPositions = { ...storedPositions };

  visiblePanels.forEach((panel, index) => {
    if (!isPanelPosition(nextPositions[panel.id])) {
      nextPositions[panel.id] = resolveDefaultPosition(panel, index);
    }
  });

  return nextPositions;
}

function samePositions(
  left: Record<string, PanelPosition>,
  right: Record<string, PanelPosition>,
  visibleIds: string[],
) {
  return visibleIds.every((id) => {
    const leftPosition = left[id];
    const rightPosition = right[id];

    return (
      leftPosition?.x === rightPosition?.x &&
      leftPosition?.y === rightPosition?.y
    );
  });
}

function shouldIgnoreDragStart(target: HTMLElement | null) {
  if (!target) {
    return true;
  }

  return target.closest(
    [
      "input",
      "textarea",
      "select",
      "option",
      "[contenteditable='true']",
      "[data-panel-no-drag='true']",
    ].join(","),
  ) != null;
}

interface DraggableDashboardProps {
  panels: DashboardPanelItem[];
  storageKey?: string;
}

export function DraggableDashboard({
  panels,
  storageKey = DASHBOARD_POSITIONS_KEY,
}: DraggableDashboardProps) {
  const visiblePanels = useMemo(
    () => panels.filter((panel) => !panel.hidden),
    [panels],
  );
  const visibleIds = useMemo(
    () => visiblePanels.map((panel) => panel.id),
    [visiblePanels],
  );
  const visibleSignature = visibleIds.join("|");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressedClickPanelIdRef = useRef<string | null>(null);
  const bodyUserSelectRef = useRef("");
  const nextZIndexRef = useRef(visiblePanels.length + 1);

  const [positions, setPositions] = useState<Record<string, PanelPosition>>(() =>
    reconcilePositions(readStoredPositions(storageKey), visiblePanels),
  );
  const positionsRef = useRef(positions);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [zIndices, setZIndices] = useState<Record<string, number>>(() =>
    visiblePanels.reduce<Record<string, number>>((acc, panel, index) => {
      acc[panel.id] = index + 1;
      return acc;
    }, {}),
  );

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    const nextPositions = reconcilePositions(readStoredPositions(storageKey), visiblePanels);

    setPositions((currentPositions) =>
      samePositions(currentPositions, nextPositions, visibleIds)
        ? currentPositions
        : nextPositions,
    );
  }, [storageKey, visiblePanels, visibleIds, visibleSignature]);

  useEffect(() => {
    setZIndices((currentZIndices) => {
      let changed = false;
      const nextZIndices = { ...currentZIndices };

      visiblePanels.forEach((panel) => {
        if (nextZIndices[panel.id] != null) {
          return;
        }

        changed = true;
        nextZIndices[panel.id] = nextZIndexRef.current++;
      });

      return changed ? nextZIndices : currentZIndices;
    });
  }, [visiblePanels, visibleSignature]);

  const stopDragging = useCallback(
    (persist: boolean) => {
      const dragSession = dragSessionRef.current;
      if (!dragSession) {
        return;
      }

      dragSessionRef.current = null;
      document.body.style.userSelect = bodyUserSelectRef.current;
      setDraggingId(null);

      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);

      if (persist && dragSession.hasMoved) {
        suppressedClickPanelIdRef.current = dragSession.id;
        writeStoredPositions(storageKey, positionsRef.current);
      }
    },
    [storageKey],
  );

  const handleWindowMouseMove = useCallback((event: MouseEvent) => {
    const dragSession = dragSessionRef.current;
    const container = containerRef.current;
    if (!dragSession || !container) {
      return;
    }

    const deltaX = event.clientX - dragSession.startClientX;
    const deltaY = event.clientY - dragSession.startClientY;

    if (!dragSession.hasMoved) {
      if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {
        return;
      }

      dragSession.hasMoved = true;
      bodyUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      setDraggingId(dragSession.id);
      setZIndices((currentZIndices) => ({
        ...currentZIndices,
        [dragSession.id]: nextZIndexRef.current++,
      }));
    }

    const rect = container.getBoundingClientRect();
    const nextPosition = {
      x: event.clientX - rect.left - dragSession.offsetX,
      y: event.clientY - rect.top - dragSession.offsetY,
    };

    setPositions((currentPositions) => {
      const currentPosition = currentPositions[dragSession.id];
      if (
        currentPosition?.x === nextPosition.x &&
        currentPosition?.y === nextPosition.y
      ) {
        return currentPositions;
      }

      const updatedPositions = {
        ...currentPositions,
        [dragSession.id]: nextPosition,
      };

      positionsRef.current = updatedPositions;
      return updatedPositions;
    });
  }, []);

  const handleWindowMouseUp = useCallback(() => {
    stopDragging(true);
  }, [stopDragging]);

  useEffect(
    () => () => {
      stopDragging(false);
    },
    [stopDragging],
  );

  const handlePanelMouseDown = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || shouldIgnoreDragStart(event.target as HTMLElement | null)) {
        return;
      }

      if (dragSessionRef.current) {
        stopDragging(false);
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const panelRect = event.currentTarget.getBoundingClientRect();

      dragSessionRef.current = {
        id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        offsetX: event.clientX - panelRect.left,
        offsetY: event.clientY - panelRect.top,
        hasMoved: false,
      };

      window.addEventListener("mousemove", handleWindowMouseMove);
      window.addEventListener("mouseup", handleWindowMouseUp);
    },
    [handleWindowMouseMove, handleWindowMouseUp, stopDragging],
  );

  const handlePanelClickCapture = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      if (suppressedClickPanelIdRef.current !== id) {
        return;
      }

      suppressedClickPanelIdRef.current = null;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  if (visiblePanels.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
    >
      {visiblePanels.map((panel, index) => {
        const position = positions[panel.id] ?? resolveDefaultPosition(panel, index);

        return (
          <FloatingPanel
            key={panel.id}
            title={panel.title}
            className={panel.className}
            position={position}
            zIndex={zIndices[panel.id] ?? index + 1}
            isDragging={draggingId === panel.id}
            onMouseDown={(event) => handlePanelMouseDown(panel.id, event)}
            onClickCapture={(event) => handlePanelClickCapture(panel.id, event)}
          >
            {panel.content}
          </FloatingPanel>
        );
      })}
    </div>
  );
}
