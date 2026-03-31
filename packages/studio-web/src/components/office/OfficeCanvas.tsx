import { useEffect, useRef, useState } from "react";
import { saveOfficeLayout } from "../../lib/api";
import { FURNITURE_SIZES, sceneToLayout } from "../../lib/office-scene";
import { useOfficeStore } from "../../stores/use-office-store";
import { useWsStore } from "../../stores/use-ws-store";
import type { OfficePosition } from "../../types/office";
import { OfficeBackground } from "./OfficeBackground";
import { Character } from "./Character";
import { Furniture } from "./Furniture";
import { Whiteboard } from "./Whiteboard";

type DragState =
  | {
      kind: "character";
      id: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "furniture";
      id: string;
      offsetX: number;
      offsetY: number;
    };

export function OfficeCanvas() {
  const scene = useOfficeStore((state) => state.scene);
  const updateCharacterPosition = useOfficeStore((state) => state.updateCharacterPosition);
  const updateFurniturePosition = useOfficeStore((state) => state.updateFurniturePosition);
  const send = useWsStore((state) => state.send);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const whiteboardFurniture = scene.furniture.find((item) => item.type === "whiteboard");
  const whiteboardPosition = whiteboardFurniture
    ? { x: whiteboardFurniture.position.x, y: Math.max(whiteboardFurniture.position.y - 26, 16) }
    : { x: 400, y: 30 };

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const position = clampPosition(
        dragState.kind,
        dragState.id,
        {
          x: event.clientX - rect.left - dragState.offsetX,
          y: event.clientY - rect.top - dragState.offsetY,
        },
        rect.width,
        rect.height,
      );

      if (dragState.kind === "character") {
        updateCharacterPosition(dragState.id, position);
      } else {
        updateFurniturePosition(dragState.id, position);
      }

      send({
        type: "kuma-studio:layout-update",
        layout: sceneToLayout(useOfficeStore.getState().scene),
      });
    };

    const handleMouseUp = () => {
      setDragState(null);
      void saveOfficeLayout(sceneToLayout(useOfficeStore.getState().scene)).catch(() => {
        // Keep the local layout even if persistence temporarily fails.
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, send, updateCharacterPosition, updateFurniturePosition]);

  return (
    <div
      ref={containerRef}
      className="relative h-[600px] w-full overflow-hidden rounded-2xl border border-stone-200 bg-amber-50/50 shadow-sm"
    >
      <OfficeBackground background={scene.background} />

      {scene.furniture.map((item) => (
        <Furniture
          key={item.id}
          furniture={item}
          isDragging={dragState?.kind === "furniture" && dragState.id === item.id}
          onDragStart={(event) => {
            event.preventDefault();
            setDragState({
              kind: "furniture",
              id: item.id,
              offsetX: event.clientX - event.currentTarget.getBoundingClientRect().left - event.currentTarget.offsetWidth / 2,
              offsetY: event.clientY - event.currentTarget.getBoundingClientRect().top - event.currentTarget.offsetHeight / 2,
            });
          }}
        />
      ))}

      {scene.characters.map((character) => (
        <Character
          key={character.id}
          character={character}
          isDragging={dragState?.kind === "character" && dragState.id === character.id}
          onDragStart={(event) => {
            event.preventDefault();
            setDragState({
              kind: "character",
              id: character.id,
              offsetX: event.clientX - event.currentTarget.getBoundingClientRect().left - 24,
              offsetY: event.clientY - event.currentTarget.getBoundingClientRect().top - 24,
            });
          }}
        />
      ))}

      <Whiteboard position={whiteboardPosition} />
    </div>
  );
}

function clampPosition(
  kind: DragState["kind"],
  id: string,
  position: OfficePosition,
  width: number,
  height: number,
): OfficePosition {
  const bounds =
    kind === "character"
      ? { halfWidth: 30, halfHeight: 30 }
      : getFurnitureBounds(id);

  return {
    x: clamp(position.x, bounds.halfWidth, Math.max(width - bounds.halfWidth, bounds.halfWidth)),
    y: clamp(position.y, bounds.halfHeight, Math.max(height - bounds.halfHeight, bounds.halfHeight)),
  };
}

function getFurnitureBounds(id: string) {
  const furniture = useOfficeStore.getState().scene.furniture.find((item) => item.id === id);
  const size = FURNITURE_SIZES[furniture?.type ?? ""] ?? { w: 40, h: 40 };

  return {
    halfWidth: size.w / 2,
    halfHeight: size.h / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
