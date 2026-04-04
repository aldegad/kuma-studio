import { useCallback, useRef, useState, type ReactNode } from "react";

export interface PanelPosition {
  x: number;
  y: number;
}

export interface DraggableDashboardItem {
  id: string;
  panel: ReactNode;
}

interface DraggableDashboardProps {
  items: DraggableDashboardItem[];
  positions: Record<string, PanelPosition>;
  className?: string;
  dragDisabled?: boolean;
  onPositionChange: (id: string, position: PanelPosition) => void;
}

const DEFAULT_PANEL_HEIGHT = 200;
const PANEL_VERTICAL_GAP = 8;
const FALLBACK_STEP = DEFAULT_PANEL_HEIGHT + PANEL_VERTICAL_GAP;

export function DraggableDashboard({
  items,
  positions,
  className,
  dragDisabled = false,
  onPositionChange,
}: DraggableDashboardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingPosition, setDraggingPosition] = useState<PanelPosition | null>(null);
  const [maxZIndex, setMaxZIndex] = useState(items.length);
  const [itemZIndex, setItemZIndex] = useState<Record<string, number>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const latestPositionRef = useRef<PanelPosition | null>(null);

  const getItemPosition = useCallback(
    (id: string, index: number): PanelPosition => {
      const savedPosition = positions[id];
      if (
        savedPosition &&
        Number.isFinite(savedPosition.x) &&
        Number.isFinite(savedPosition.y)
      ) {
        return savedPosition;
      }
      return {
        x: 0,
        y: index * FALLBACK_STEP,
      };
    },
    [positions],
  );

  const getZIndex = useCallback(
    (id: string, index: number) => {
      return itemZIndex[id] ?? index + 1;
    },
    [itemZIndex, maxZIndex],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      const container = containerRef.current;
      if (!dragState || !container) return;

      const rect = container.getBoundingClientRect();
      const nextPosition = {
        x: event.clientX - rect.left - dragState.offsetX,
        y: event.clientY - rect.top - dragState.offsetY,
      };

      latestPositionRef.current = nextPosition;
      setDraggingPosition(nextPosition);
      onPositionChange(dragState.id, nextPosition);
    },
    [onPositionChange],
  );

  const stopDragging = useCallback(() => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const finalPosition = latestPositionRef.current;
    if (finalPosition) {
      onPositionChange(dragState.id, finalPosition);
    }

    dragStateRef.current = null;
    latestPositionRef.current = null;
    setDraggingId(null);
    setDraggingPosition(null);

    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", stopDragging);
  }, [handleMouseMove, onPositionChange]);

  const handleMouseDown = useCallback(
    (id: string, startPosition: PanelPosition, event: React.MouseEvent<HTMLDivElement>) => {
      if (dragDisabled || event.button !== 0) return;

      const tag = (event.target as HTMLElement).tagName.toLowerCase();
      if (["input", "textarea", "button", "a", "select"].includes(tag)) return;

      event.preventDefault();

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      const mouseInContainerX = event.clientX - rect.left;
      const mouseInContainerY = event.clientY - rect.top;

      dragStateRef.current = {
        id,
        offsetX: mouseInContainerX - startPosition.x,
        offsetY: mouseInContainerY - startPosition.y,
      };

      latestPositionRef.current = startPosition;
      setDraggingId(id);
      setDraggingPosition(startPosition);

      setMaxZIndex((previousMaxZ) => {
        const nextZ = previousMaxZ + 1;
        setItemZIndex((previous) => ({
          ...previous,
          [id]: nextZ,
        }));
        return nextZ;
      });

      onPositionChange(id, startPosition);

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", stopDragging);
    },
    [dragDisabled, handleMouseMove, onPositionChange, stopDragging],
  );

  if (dragDisabled) {
    return (
      <div
        className={className}
        style={{ position: "relative", width: "100%", height: "100%", overflow: "auto" }}
      >
        {items.map((item) => (
          <div key={item.id}>{item.panel}</div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "auto" }}
    >
      {items.map((item, index) => {
        const basePosition = getItemPosition(item.id, index);
        const isDragging = draggingId === item.id;
        const position = isDragging && draggingPosition ? draggingPosition : basePosition;

        return (
          <div
            key={item.id}
            onMouseDown={(event) => handleMouseDown(item.id, basePosition, event)}
            style={{
              position: "absolute",
              top: `${position.y}px`,
              left: `${position.x}px`,
              zIndex: getZIndex(item.id, index),
              cursor: isDragging ? "grabbing" : "grab",
              opacity: isDragging ? 0.8 : 1,
              boxShadow: isDragging ? "0 6px 14px rgba(0, 0, 0, 0.16)" : "none",
              transition: isDragging
                ? "none"
                : "top 150ms ease, left 150ms ease, opacity 150ms ease, box-shadow 150ms ease",
            }}
          >
            {item.panel}
          </div>
        );
      })}
    </div>
  );
}
