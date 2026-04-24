import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { PanelIcon } from "./PanelIcon";
import { FloatingPanel, type PanelMotionState, type PanelMotionVector } from "./SortablePanel";

const DASHBOARD_POSITIONS_KEY = "kuma-studio-panel-positions";
const DASHBOARD_MINIMIZED_KEY = "kuma-studio-panel-minimized";
const DEFAULT_PANEL_X = 16;
const DEFAULT_PANEL_Y = 56;
const DEFAULT_PANEL_VERTICAL_STEP = 148;
const DRAG_THRESHOLD_PX = 5;
const VIEWPORT_EDGE_MARGIN = 8;
const PANEL_MOTION_SETTLE_MS = 340;

interface PanelSize {
  width: number;
  height: number;
}

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

function readStoredStringArray(storageKey: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeStoredStringArray(storageKey: string, values: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(values));
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

function clampPositionToViewport(
  position: PanelPosition,
  containerWidth: number,
  containerHeight: number,
  panelWidth = 0,
  panelHeight = 0,
): PanelPosition {
  const maxX = Math.max(0, containerWidth - Math.max(panelWidth, VIEWPORT_EDGE_MARGIN * 2));
  const maxY = Math.max(0, containerHeight - Math.max(panelHeight, VIEWPORT_EDGE_MARGIN * 2));
  return {
    x: Math.max(0, Math.min(position.x, maxX)),
    y: Math.max(0, Math.min(position.y, maxY)),
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

  // Only allow drag initiation from the title bar
  if (!target.closest(".game-panel-titlebar")) {
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
  minimizedStorageKey?: string;
}

export function DraggableDashboard({
  panels,
  storageKey = DASHBOARD_POSITIONS_KEY,
  minimizedStorageKey = DASHBOARD_MINIMIZED_KEY,
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
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleSignature]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const minimizeTimersRef = useRef<Record<string, number>>({});
  const restoreTimersRef = useRef<Record<string, number>>({});
  const minimizeOriginsRef = useRef<Record<string, PanelMotionVector>>({});
  const restoreOriginsRef = useRef<Record<string, PanelMotionVector>>({});
  const panelSizesRef = useRef<Record<string, PanelSize>>({});
  const suppressedClickPanelIdRef = useRef<string | null>(null);
  const bodyUserSelectRef = useRef("");
  const nextZIndexRef = useRef(visiblePanels.length + 1);

  const [positions, setPositions] = useState<Record<string, PanelPosition>>(() =>
    reconcilePositions(readStoredPositions(storageKey), visiblePanels),
  );
  const positionsRef = useRef(positions);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [minimizedIds, setMinimizedIds] = useState<string[]>(() =>
    readStoredStringArray(minimizedStorageKey).filter((id) => visibleIds.includes(id)),
  );
  const [pendingMinimizeIds, setPendingMinimizeIds] = useState<string[]>([]);
  const [pendingRestoreIds, setPendingRestoreIds] = useState<string[]>([]);
  const [minimizingIds, setMinimizingIds] = useState<string[]>([]);
  const [restoringIds, setRestoringIds] = useState<string[]>([]);
  const [motionVectors, setMotionVectors] = useState<Record<string, PanelMotionVector>>({});
  const [zIndices, setZIndices] = useState<Record<string, number>>(() =>
    visiblePanels.reduce<Record<string, number>>((acc, panel, index) => {
      acc[panel.id] = index + 1;
      return acc;
    }, {}),
  );
  const minimizedIdSet = useMemo(() => new Set(minimizedIds), [minimizedIds]);
  const pendingMinimizeIdSet = useMemo(() => new Set(pendingMinimizeIds), [pendingMinimizeIds]);
  const pendingRestoreIdSet = useMemo(() => new Set(pendingRestoreIds), [pendingRestoreIds]);
  const minimizingIdSet = useMemo(() => new Set(minimizingIds), [minimizingIds]);
  const restoringIdSet = useMemo(() => new Set(restoringIds), [restoringIds]);
  const dockedIdSet = useMemo(
    () => new Set([...minimizedIds, ...pendingMinimizeIds, ...minimizingIds]),
    [minimizedIds, pendingMinimizeIds, minimizingIds],
  );
  const floatingPanels = useMemo(
    () => visiblePanels.filter((panel) => !minimizedIdSet.has(panel.id)),
    [visiblePanels, minimizedIdSet],
  );
  const dockedPanels = useMemo(
    () => visiblePanels.filter((panel) => dockedIdSet.has(panel.id)),
    [dockedIdSet, visiblePanels],
  );
  const floatingIds = useMemo(
    () => floatingPanels.map((panel) => panel.id),
    [floatingPanels],
  );
  const floatingSignature = floatingIds.join("|");

  const readPanelCenter = useCallback((id: string) => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }

    const panelElement = container.querySelector<HTMLElement>(`[data-panel-id="${id}"]`);
    if (panelElement) {
      const rect = panelElement.getBoundingClientRect();
      panelSizesRef.current[id] = {
        width: rect.width,
        height: rect.height,
      };
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    const position = positionsRef.current[id];
    if (!position) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    const size = panelSizesRef.current[id] ?? { width: 288, height: 168 };
    return {
      x: containerRect.left + position.x + size.width / 2,
      y: containerRect.top + position.y + size.height / 2,
    };
  }, []);

  const readDockButtonCenter = useCallback((id: string) => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }

    const dockButton = container.querySelector<HTMLElement>(`[data-dock-panel-id="${id}"]`);
    if (!dockButton) {
      return null;
    }

    const rect = dockButton.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);

  const setMotionVectorFromPoints = useCallback((id: string, from: { x: number; y: number } | null, to: { x: number; y: number } | null) => {
    if (!from || !to) {
      setMotionVectors((currentVectors) => {
        const currentVector = currentVectors[id];
        if (currentVector?.x === 0 && currentVector.y === 0) {
          return currentVectors;
        }

        return {
          ...currentVectors,
          [id]: { x: 0, y: 0 },
        };
      });
      return;
    }

    setMotionVectors((currentVectors) => {
      const nextVector = {
        x: to.x - from.x,
        y: to.y - from.y,
      };
      const currentVector = currentVectors[id];
      if (currentVector?.x === nextVector.x && currentVector.y === nextVector.y) {
        return currentVectors;
      }

      return {
        ...currentVectors,
        [id]: nextVector,
      };
    });
  }, []);

  const clearMotionVector = useCallback((id: string) => {
    setMotionVectors((currentVectors) => {
      const { [id]: _removed, ...nextVectors } = currentVectors;
      return nextVectors;
    });
  }, []);

  const finishMinimize = useCallback(
    (id: string) => {
      setMinimizedIds((currentIds) => {
        if (currentIds.includes(id)) {
          return currentIds;
        }

        const nextIds = [...currentIds, id];
        writeStoredStringArray(minimizedStorageKey, nextIds);
        return nextIds;
      });
      setMinimizingIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
      delete minimizeOriginsRef.current[id];
      clearMotionVector(id);
      delete minimizeTimersRef.current[id];
    },
    [clearMotionVector, minimizedStorageKey],
  );

  const finishRestore = useCallback(
    (id: string) => {
      setRestoringIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
      delete restoreOriginsRef.current[id];
      clearMotionVector(id);
      delete restoreTimersRef.current[id];
    },
    [clearMotionVector],
  );

  useLayoutEffect(() => {
    const animationFrames: number[] = [];

    for (const id of pendingMinimizeIds) {
      const panelCenter = minimizeOriginsRef.current[id];
      const dockCenter = readDockButtonCenter(id);
      if (!panelCenter || !dockCenter) {
        delete minimizeOriginsRef.current[id];
        setPendingMinimizeIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
        continue;
      }

      setMotionVectorFromPoints(id, panelCenter, dockCenter);
      const frame = window.requestAnimationFrame(() => {
        setPendingMinimizeIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
        setMinimizingIds((currentIds) => (currentIds.includes(id) ? currentIds : [...currentIds, id]));
        minimizeTimersRef.current[id] = window.setTimeout(() => {
          finishMinimize(id);
        }, PANEL_MOTION_SETTLE_MS);
      });
      animationFrames.push(frame);
    }

    for (const id of pendingRestoreIds) {
      const dockCenter = restoreOriginsRef.current[id];
      const panelCenter = readPanelCenter(id);
      if (!dockCenter || !panelCenter) {
        delete restoreOriginsRef.current[id];
        setPendingRestoreIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
        continue;
      }

      setMotionVectorFromPoints(id, panelCenter, dockCenter);
      const frame = window.requestAnimationFrame(() => {
        setPendingRestoreIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
        setRestoringIds((currentIds) => (currentIds.includes(id) ? currentIds : [...currentIds, id]));
        restoreTimersRef.current[id] = window.setTimeout(() => {
          finishRestore(id);
        }, PANEL_MOTION_SETTLE_MS);
      });
      animationFrames.push(frame);
    }

    return () => {
      animationFrames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [
    finishMinimize,
    finishRestore,
    pendingMinimizeIds,
    pendingRestoreIds,
    readDockButtonCenter,
    readPanelCenter,
    setMotionVectorFromPoints,
  ]);

  useEffect(
    () => () => {
      Object.values(minimizeTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      Object.values(restoreTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    setMinimizedIds((currentIds) => {
      const nextIds = currentIds.filter((id) => visibleIdSet.has(id));
      if (nextIds.length === currentIds.length) {
        return currentIds;
      }
      writeStoredStringArray(minimizedStorageKey, nextIds);
      return nextIds;
    });
  }, [minimizedStorageKey, visibleIdSet]);

  // Reconcile positions when the set of visible panels changes.
  // IMPORTANT: depend on visibleSignature (a stable string), NOT on
  // visiblePanels / visibleIds (new array refs every render).  Using
  // unstable refs caused the effect to fire during drag, overwriting
  // the dragged position with stale localStorage values.
  useEffect(() => {
    // Skip reconciliation while a drag is in progress — the live
    // position lives in React state; localStorage is written on drop.
    if (draggingId !== null) return;

    const nextPositions = reconcilePositions(readStoredPositions(storageKey), visiblePanels);

    setPositions((currentPositions) =>
      samePositions(currentPositions, nextPositions, visibleIds)
        ? currentPositions
        : nextPositions,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, visibleSignature, draggingId]);

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

  // Clamp panels into viewport on mount and on every resize.
  // Shrink → panels are pushed inward.  Grow → panels return to their
  // stored (intended) positions if they now fit.  We always re-clamp from
  // localStorage so that resize-only clamping is reversible.
  useEffect(() => {
    const clampAllPanels = () => {
      if (dragSessionRef.current) return;
      const container = containerRef.current;
      if (!container) return;

      const { width: cw, height: ch } = container.getBoundingClientRect();
      if (cw === 0 || ch === 0) return;

      // Always start from STORED positions (user's intended positions),
      // not the current possibly-clamped React state.
      const stored = reconcilePositions(readStoredPositions(storageKey), visiblePanels);

      setPositions((current) => {
        let changed = false;
        const next = { ...current };

        for (const id of floatingIds) {
          const intendedPos = stored[id];
          if (!intendedPos) continue;
          const el = container.querySelector<HTMLElement>(`[data-panel-id="${id}"]`);
          const clamped = clampPositionToViewport(intendedPos, cw, ch, el?.offsetWidth ?? 0, el?.offsetHeight ?? 0);
          if (clamped.x !== next[id]?.x || clamped.y !== next[id]?.y) {
            next[id] = clamped;
            changed = true;
          }
        }

        if (changed) {
          positionsRef.current = next;
          // Do NOT write to localStorage — keep user's intended positions intact
        }
        return changed ? next : current;
      });
    };

    // Run once immediately so panels loaded from localStorage
    // (saved at a larger viewport) are clamped on first paint.
    clampAllPanels();

    window.addEventListener("resize", clampAllPanels);
    return () => window.removeEventListener("resize", clampAllPanels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, visibleSignature, floatingSignature]);

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
    }

    const rect = container.getBoundingClientRect();
    const panelEl = container.querySelector<HTMLElement>(`[data-panel-id="${dragSession.id}"]`);
    const panelWidth = panelEl?.offsetWidth ?? 0;
    const panelHeight = panelEl?.offsetHeight ?? 0;
    const rawPosition = {
      x: event.clientX - rect.left - dragSession.offsetX,
      y: event.clientY - rect.top - dragSession.offsetY,
    };
    const nextPosition = clampPositionToViewport(
      rawPosition,
      rect.width,
      rect.height,
      panelWidth,
      panelHeight,
    );

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
      if (event.button !== 0) {
        return;
      }

      // Raise this panel above its siblings on any interaction — a click on
      // the body (e.g. expanding the CMUX dropdown) must not be covered by
      // panels below. Without this, z-index only bumped after drag threshold.
      setZIndices((current) => ({
        ...current,
        [id]: nextZIndexRef.current++,
      }));

      if (shouldIgnoreDragStart(event.target as HTMLElement | null)) {
        return;
      }

      // Prevent native button press / text-selection from stealing the pointer.
      // This does NOT suppress the subsequent click event, so header buttons
      // (collapse/expand) still work for simple clicks.
      event.preventDefault();

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

  const minimizePanel = useCallback(
    (id: string) => {
      if (minimizeTimersRef.current[id] || pendingMinimizeIdSet.has(id) || minimizingIdSet.has(id)) {
        return;
      }

      if (restoreTimersRef.current[id]) {
        window.clearTimeout(restoreTimersRef.current[id]);
        delete restoreTimersRef.current[id];
        setRestoringIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
        delete restoreOriginsRef.current[id];
        clearMotionVector(id);
      }

      const panelCenter = readPanelCenter(id);
      if (!panelCenter) {
        return;
      }

      minimizeOriginsRef.current[id] = panelCenter;
      setPendingMinimizeIds((currentIds) => (
        currentIds.includes(id) ? currentIds : [...currentIds, id]
      ));
    },
    [clearMotionVector, minimizingIdSet, pendingMinimizeIdSet, readPanelCenter],
  );

  const restorePanel = useCallback(
    (id: string, event?: ReactMouseEvent<HTMLButtonElement>) => {
      if (minimizeTimersRef.current[id]) {
        window.clearTimeout(minimizeTimersRef.current[id]);
        delete minimizeTimersRef.current[id];
        setMinimizingIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
        delete minimizeOriginsRef.current[id];
        clearMotionVector(id);
      }

      if (restoreTimersRef.current[id] || pendingRestoreIdSet.has(id) || restoringIdSet.has(id)) {
        return;
      }

      const dockRect = event?.currentTarget.getBoundingClientRect();
      const dockCenter = dockRect
        ? {
            x: dockRect.left + dockRect.width / 2,
            y: dockRect.top + dockRect.height / 2,
          }
        : readDockButtonCenter(id);
      if (!dockCenter) {
        return;
      }

      restoreOriginsRef.current[id] = dockCenter;

      setMinimizedIds((currentIds) => {
        if (!currentIds.includes(id)) {
          return currentIds;
        }

        const nextIds = currentIds.filter((currentId) => currentId !== id);
        writeStoredStringArray(minimizedStorageKey, nextIds);
        return nextIds;
      });
      setPendingRestoreIds((currentIds) => (
        currentIds.includes(id) ? currentIds : [...currentIds, id]
      ));
      setZIndices((current) => ({
        ...current,
        [id]: nextZIndexRef.current++,
      }));
    },
    [clearMotionVector, minimizedStorageKey, pendingRestoreIdSet, readDockButtonCenter, restoringIdSet],
  );

  const getPanelMotionState = useCallback(
    (id: string): PanelMotionState => {
      if (pendingRestoreIdSet.has(id)) {
        return "measuring";
      }

      if (minimizingIdSet.has(id)) {
        return "minimizing";
      }

      if (restoringIdSet.has(id)) {
        return "restoring";
      }

      return "idle";
    },
    [minimizingIdSet, pendingRestoreIdSet, restoringIdSet],
  );

  if (visiblePanels.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-40 overflow-hidden max-[768px]:kuma-mobile-panels"
    >
      {floatingPanels.map((panel, index) => {
        const position = positions[panel.id] ?? resolveDefaultPosition(panel, index);

        return (
          <FloatingPanel
            key={panel.id}
            panelId={panel.id}
            title={panel.title}
            className={panel.className}
            position={position}
            zIndex={zIndices[panel.id] ?? index + 1}
            isDragging={draggingId === panel.id}
            onMouseDown={(event) => handlePanelMouseDown(panel.id, event)}
            onClickCapture={(event) => handlePanelClickCapture(panel.id, event)}
            onMinimize={() => minimizePanel(panel.id)}
            motionState={getPanelMotionState(panel.id)}
            motionVector={motionVectors[panel.id]}
          >
            {panel.content}
          </FloatingPanel>
        );
      })}
      {dockedPanels.length > 0 && (
        <div
          className="game-panel-dock pointer-events-auto absolute bottom-4 z-[65] flex max-w-[min(42vw,28rem)] items-center gap-1.5 overflow-x-auto rounded-lg px-2 py-1.5"
          style={{
            right: "calc(1rem + 12.25rem)",
          }}
          aria-label="최소화된 패널"
        >
          {dockedPanels.map((panel) => {
            const isDockButtonLive = minimizedIdSet.has(panel.id);
            return (
              <button
                key={panel.id}
                type="button"
                data-dock-panel-id={panel.id}
                onClick={(event) => restorePanel(panel.id, event)}
                className={`group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-200/20 bg-amber-100/10 text-amber-200/75 transition-all hover:-translate-y-0.5 hover:border-amber-200/45 hover:bg-amber-100/18 hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200/50 ${
                  isDockButtonLive
                    ? "animate-kuma-dock-pop"
                    : "pointer-events-none opacity-0 scale-75"
                }`}
                title={`${panel.title} 열기`}
                aria-label={`${panel.title} 패널 열기`}
              >
                <PanelIcon panelId={panel.id} className="h-4 w-4" />
                <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-amber-300/70 shadow-[0_0_6px_rgba(252,211,77,0.65)]" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
