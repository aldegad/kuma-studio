import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import type { ReactNode } from "react";
import { SortablePanel } from "./SortablePanel";

const DASHBOARD_LAYOUT_KEY = "kuma-dashboard-layout";

export interface DashboardPanelItem {
  id: string;
  title: string;
  content: ReactNode;
  hidden?: boolean;
  className?: string;
}

function readStoredOrder(storageKey: string): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return null;
  }
}

function writeStoredOrder(storageKey: string, order: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(order));
}

function reconcileOrder(order: string[], availableIds: string[]) {
  const available = new Set(availableIds);
  const seen = new Set<string>();
  const next: string[] = [];

  for (const id of order) {
    if (available.has(id) && !seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }

  for (const id of availableIds) {
    if (!seen.has(id)) {
      next.push(id);
    }
  }

  return next;
}

function sameOrder(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function useDragDisabledOnMobile() {
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const update = () => setDisabled(mediaQuery.matches);

    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return disabled;
}

interface DraggableDashboardProps {
  panels: DashboardPanelItem[];
  storageKey?: string;
}

export function DraggableDashboard({
  panels,
  storageKey = DASHBOARD_LAYOUT_KEY,
}: DraggableDashboardProps) {
  const dragDisabled = useDragDisabledOnMobile();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const visiblePanels = useMemo(
    () => panels.filter((panel) => !panel.hidden),
    [panels],
  );
  const availableIds = useMemo(
    () => visiblePanels.map((panel) => panel.id),
    [visiblePanels],
  );
  const availableSignature = availableIds.join("|");
  const [order, setOrder] = useState<string[]>(availableIds);

  useEffect(() => {
    const savedOrder = readStoredOrder(storageKey);
    const nextOrder = reconcileOrder(savedOrder ?? availableIds, availableIds);

    setOrder((currentOrder) =>
      sameOrder(currentOrder, nextOrder) ? currentOrder : nextOrder,
    );
  }, [availableSignature, storageKey]);

  const panelMap = useMemo(
    () => new Map(visiblePanels.map((panel) => [panel.id, panel])),
    [visiblePanels],
  );

  const orderedPanels = useMemo(() => {
    const nextPanels = order
      .map((id) => panelMap.get(id))
      .filter((panel): panel is DashboardPanelItem => panel != null);

    if (nextPanels.length === visiblePanels.length) {
      return nextPanels;
    }

    const included = new Set(nextPanels.map((panel) => panel.id));
    return nextPanels.concat(
      visiblePanels.filter((panel) => !included.has(panel.id)),
    );
  }, [order, panelMap, visiblePanels]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    setOrder((currentOrder) => {
      const oldIndex = currentOrder.indexOf(String(active.id));
      const newIndex = currentOrder.indexOf(String(over.id));

      if (oldIndex === -1 || newIndex === -1) {
        return currentOrder;
      }

      const nextOrder = arrayMove(currentOrder, oldIndex, newIndex);
      writeStoredOrder(storageKey, nextOrder);
      return nextOrder;
    });
  }

  if (orderedPanels.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-4 top-14 z-30 w-[min(52rem,calc(100vw-2rem))] max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
      <div className="pointer-events-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={orderedPanels.map((panel) => panel.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {orderedPanels.map((panel) => (
                <SortablePanel
                  key={panel.id}
                  id={panel.id}
                  title={panel.title}
                  disabled={dragDisabled}
                  className={panel.className}
                >
                  {panel.content}
                </SortablePanel>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
