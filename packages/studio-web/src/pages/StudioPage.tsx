import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDailyReport, fetchJobCards, fetchOfficeLayout, fetchStats } from "../lib/api";
import { useWebSocket } from "../hooks/use-websocket";
import { useDashboardStore } from "../stores/use-dashboard-store";
import { useOfficeStore } from "../stores/use-office-store";
import {
  PIPELINE_STAGE_ORDER,
  type PipelineAgentStatus,
  type PipelineStageId,
  usePipelineStore,
} from "../stores/use-pipeline-store";
import { useWsStore } from "../stores/use-ws-store";
import { saveOfficeLayout } from "../lib/api";
import { FURNITURE_SIZES, sceneToLayout } from "../lib/office-scene";
import type { AgentState } from "../types/agent";
import type { JobCard } from "../types/job-card";
import type { OfficePosition } from "../types/office";
import { OfficeBackground } from "../components/office/OfficeBackground";
import { Character } from "../components/office/Character";
import { Furniture } from "../components/office/Furniture";
import { Whiteboard } from "../components/office/Whiteboard";
import { SkillsPanel } from "../components/dashboard/SkillsPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: JobCard }
    | { kind: "agent-state-change"; agentId: string; state: AgentState };
}

type DragState =
  | { kind: "character"; id: string; offsetX: number; offsetY: number }
  | { kind: "furniture"; id: string; offsetX: number; offsetY: number }
  | { kind: "pan"; startX: number; startY: number; startPanX: number; startPanY: number };

// ---------------------------------------------------------------------------
// Pipeline HUD metadata
// ---------------------------------------------------------------------------

const stageMeta: Record<PipelineStageId, { title: string; color: string; badge: string }> = {
  decompose: { title: "분해", color: "text-amber-700", badge: "bg-amber-100 text-amber-800" },
  parallel:  { title: "병렬실행", color: "text-sky-700",  badge: "bg-sky-100 text-sky-800" },
  gate:      { title: "게이트", color: "text-emerald-700", badge: "bg-emerald-100 text-emerald-800" },
  review:    { title: "리뷰",   color: "text-rose-700",  badge: "bg-rose-100 text-rose-800" },
};

const statusDot: Record<PipelineAgentStatus, string> = {
  idle:    "bg-stone-300",
  working: "bg-blue-400",
  done:    "bg-green-400",
  error:   "bg-red-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJobs(payload: unknown): JobCard[] {
  if (Array.isArray(payload)) return payload as JobCard[];
  if (payload && typeof payload === "object" && "cards" in payload) {
    const c = payload as { cards?: unknown };
    if (Array.isArray(c.cards)) return c.cards as JobCard[];
  }
  return [];
}

// Canvas internal dimensions (the world inside the transform)
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 1500;

// Zoom defaults & limits
const ZOOM_DEFAULT = 0.7;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.0;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
// StudioPage — full-viewport game-screen layout
// ---------------------------------------------------------------------------

export function StudioPage() {
  const { status } = useWebSocket();
  const ws = useWsStore((state) => state.ws);
  const send = useWsStore((state) => state.send);

  // Dashboard store
  const stats = useDashboardStore((state) => state.stats);
  const setStats = useDashboardStore((state) => state.setStats);
  const setDailyReport = useDashboardStore((state) => state.setDailyReport);
  const jobs = useDashboardStore((state) => state.jobs);

  // Office store
  const scene = useOfficeStore((state) => state.scene);
  const applyLayout = useOfficeStore((state) => state.applyLayout);
  const updateCharacterPosition = useOfficeStore((state) => state.updateCharacterPosition);
  const updateFurniturePosition = useOfficeStore((state) => state.updateFurniturePosition);

  // Pipeline store
  const stages = usePipelineStore((state) => state.stages);
  const hydrateFromJobs = usePipelineStore((state) => state.hydrateFromJobs);
  const syncJob = usePipelineStore((state) => state.syncJob);
  const updateAgentState = usePipelineStore((state) => state.updateAgentState);

  // Canvas drag
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Zoom & pan state
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Pipeline HUD collapsed state
  const [pipelineCollapsed, setPipelineCollapsed] = useState(false);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, report] = await Promise.all([fetchStats(), fetchDailyReport()]);
        if (!cancelled) { setStats(s); setDailyReport(report); }
      } catch { /* live via websocket */ }
    })();
    return () => { cancelled = true; };
  }, [setDailyReport, setStats]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const layout = await fetchOfficeLayout();
        if (!cancelled) applyLayout(layout);
      } catch { /* keep local layout */ }
    })();
    return () => { cancelled = true; };
  }, [applyLayout]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchJobCards();
        if (cancelled) return;
        hydrateFromJobs(extractJobs(response));
      } catch { /* live via websocket */ }
    })();
    return () => { cancelled = true; };
  }, [hydrateFromJobs]);

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!ws) return;
    const handleMessage = (e: MessageEvent) => {
      try {
        const data: StudioEvent = JSON.parse(e.data as string);
        if (data.type !== "kuma-studio:event") return;
        const ev = data.event;
        if (ev.kind === "job-card-update") syncJob(ev.card);
        else if (ev.kind === "agent-state-change") updateAgentState(ev.agentId, ev.state);
      } catch { /* ignore */ }
    };
    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [syncJob, updateAgentState, ws]);

  // -------------------------------------------------------------------------
  // Drag logic
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (dragState.kind === "pan") {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        setPanX(dragState.startPanX + dx);
        setPanY(dragState.startPanY + dy);
        return;
      }

      const rect = container.getBoundingClientRect();
      // Convert screen coords to canvas coords (accounting for zoom & pan)
      const canvasX = (e.clientX - rect.left - panX) / zoom - dragState.offsetX;
      const canvasY = (e.clientY - rect.top - panY) / zoom - dragState.offsetY;
      const position = clampPosition(
        dragState.kind,
        dragState.id,
        { x: canvasX, y: canvasY },
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
      );
      if (dragState.kind === "character") updateCharacterPosition(dragState.id, position);
      else updateFurniturePosition(dragState.id, position);
      send({ type: "kuma-studio:layout-update", layout: sceneToLayout(useOfficeStore.getState().scene) });
    };

    const handleMouseUp = () => {
      const wasPan = dragState.kind === "pan";
      setDragState(null);
      if (!wasPan) {
        void saveOfficeLayout(sceneToLayout(useOfficeStore.getState().scene)).catch(() => {});
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, zoom, panX, panY, send, updateCharacterPosition, updateFurniturePosition]);

  // -------------------------------------------------------------------------
  // Wheel → zoom (cursor-centered)
  // -------------------------------------------------------------------------

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

      // Keep the point under the cursor stationary
      const newPanX = mouseX - (mouseX - panX) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - panY) * (newZoom / zoom);

      setZoom(newZoom);
      setPanX(newPanX);
      setPanY(newPanY);
    },
    [zoom, panX, panY],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // passive: false so we can preventDefault to stop page scroll
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // -------------------------------------------------------------------------
  // Container mousedown → start pan (only fires on empty space)
  // -------------------------------------------------------------------------

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only primary button
      if (e.button !== 0) return;
      // If the click target is NOT the container itself or the background,
      // a child (character/furniture) already called stopPropagation so we
      // won't reach here.
      e.preventDefault();
      setDragState({
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        startPanX: panX,
        startPanY: panY,
      });
    },
    [panX, panY],
  );

  // -------------------------------------------------------------------------
  // Whiteboard position
  // -------------------------------------------------------------------------

  const whiteboardFurniture = scene.furniture.find((item) => item.type === "whiteboard");
  const whiteboardPosition = whiteboardFurniture
    ? { x: whiteboardFurniture.position.x, y: Math.max(whiteboardFurniture.position.y - 26, 16) }
    : { x: 400, y: 30 };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="h-screen w-screen overflow-hidden relative select-none" style={{ background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 30%, #fef9ee 100%)" }}>

      {/* ------------------------------------------------------------------ */}
      {/* Office canvas — full background with zoom/pan                       */}
      {/* ------------------------------------------------------------------ */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden"
        onMouseDown={handleCanvasMouseDown}
        style={{ cursor: dragState?.kind === "pan" ? "grabbing" : "grab" }}
      >
        <div
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <OfficeBackground background={scene.background} />

          {scene.furniture.map((item) => (
            <Furniture
              key={item.id}
              furniture={item}
              isDragging={dragState?.kind === "furniture" && dragState.id === item.id}
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation(); // prevent canvas pan
                const elRect = event.currentTarget.getBoundingClientRect();
                setDragState({
                  kind: "furniture",
                  id: item.id,
                  offsetX: (event.clientX - elRect.left) / zoom - event.currentTarget.offsetWidth / 2,
                  offsetY: (event.clientY - elRect.top) / zoom - event.currentTarget.offsetHeight / 2,
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
                event.stopPropagation(); // prevent canvas pan
                const elRect = event.currentTarget.getBoundingClientRect();
                setDragState({
                  kind: "character",
                  id: character.id,
                  offsetX: (event.clientX - elRect.left) / zoom - event.currentTarget.offsetWidth / 2,
                  offsetY: (event.clientY - elRect.top) / zoom - event.currentTarget.offsetHeight / 2,
                });
              }}
            />
          ))}

          <Whiteboard position={whiteboardPosition} />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Top bar HUD                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-2 bg-white/60 backdrop-blur-md border-b border-white/40 shadow-sm">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tight text-amber-900">쿠마 스튜디오</span>
          <span className="text-xs font-medium text-stone-400 hidden sm:inline">가상 사무실</span>
        </div>

        {/* Connection badge */}
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
          status === "connected"
            ? "bg-green-100 text-green-700"
            : status === "connecting"
            ? "bg-amber-100 text-amber-700"
            : "bg-red-100 text-red-700"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            status === "connected" ? "bg-green-500" : status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-red-500"
          }`} />
          {status === "connected" ? "연결됨" : status === "connecting" ? "연결 중..." : "연결 끊김"}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Pipeline HUD — top-right floating panel                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="absolute top-14 right-4 z-30 w-72">
        <div className="rounded-2xl bg-white/75 backdrop-blur-md border border-white/50 shadow-lg overflow-hidden">
          {/* Header */}
          <button
            type="button"
            onClick={() => setPipelineCollapsed((c) => !c)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/40 transition-colors"
          >
            <span className="text-xs font-bold text-stone-700 uppercase tracking-wider">파이프라인</span>
            <span className="text-stone-400 text-xs">{pipelineCollapsed ? "▼" : "▲"}</span>
          </button>

          {!pipelineCollapsed && (
            <div className="px-3 pb-3 pt-1 space-y-2">
              {/* Stage flow */}
              <div className="flex items-center gap-1">
                {PIPELINE_STAGE_ORDER.map((stageId, idx) => {
                  const meta = stageMeta[stageId];
                  const activeCount = stages[stageId].filter((a) => a.status !== "idle").length;
                  return (
                    <div key={stageId} className="flex items-center gap-1 flex-1 min-w-0">
                      <div className="flex-1 min-w-0 rounded-lg bg-white/80 border border-stone-200/60 px-2 py-1.5 text-center">
                        <p className={`text-[10px] font-bold ${meta.color} truncate`}>{meta.title}</p>
                        <span className={`inline-block mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${meta.badge}`}>
                          {activeCount}
                        </span>
                      </div>
                      {idx < PIPELINE_STAGE_ORDER.length - 1 && (
                        <span className="text-stone-300 text-[10px] flex-shrink-0">→</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Agent rows for active agents only */}
              {PIPELINE_STAGE_ORDER.flatMap((stageId) =>
                stages[stageId]
                  .filter((a) => a.status !== "idle")
                  .map((agent) => (
                    <div key={`${stageId}-${agent.id}`} className="flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 border border-stone-100">
                      <span className="text-sm">{agent.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-stone-800 truncate">{agent.name}</p>
                        <p className="text-[9px] text-stone-400 truncate">{agent.currentTask}</p>
                      </div>
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${statusDot[agent.status]}`} />
                    </div>
                  ))
              )}

              {PIPELINE_STAGE_ORDER.every((id) => stages[id].every((a) => a.status === "idle")) && (
                <p className="text-center text-[10px] text-stone-400 py-1">활성 작업 없음</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Skills Panel — bottom-right floating panel                          */}
      {/* ------------------------------------------------------------------ */}
      <SkillsPanel />

      {/* ------------------------------------------------------------------ */}
      {/* Stats HUD — bottom-left floating badges                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="absolute bottom-4 left-4 z-30 flex flex-col gap-2">
        <div className="rounded-2xl bg-white/75 backdrop-blur-md border border-white/50 shadow-lg px-4 py-3">
          <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-2">작업 현황</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatBadge label="전체" value={stats.totalJobs} color="text-stone-700" />
            <StatBadge label="진행" value={stats.inProgressJobs} color="text-blue-600" dot="bg-blue-400" />
            <StatBadge label="완료" value={stats.completedJobs} color="text-green-700" dot="bg-green-400" />
            <StatBadge label="오류" value={stats.errorJobs} color="text-red-600" dot="bg-red-400" />
          </div>
        </div>

        {jobs.length > 0 && (
          <div className="rounded-2xl bg-white/75 backdrop-blur-md border border-white/50 shadow-lg px-4 py-2">
            <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">최근 작업</p>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {jobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                    job.status === "completed" ? "bg-green-400"
                    : job.status === "error" ? "bg-red-400"
                    : job.status === "in_progress" ? "bg-blue-400"
                    : "bg-stone-300"
                  }`} />
                  <p className="text-[9px] text-stone-600 truncate max-w-[160px]">{job.message || job.id}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatBadge
// ---------------------------------------------------------------------------

function StatBadge({ label, value, color, dot }: { label: string; value: number; color: string; dot?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {dot && <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />}
      <span className="text-[10px] text-stone-500">{label}</span>
      <span className={`text-xs font-bold ${color}`}>{value}</span>
    </div>
  );
}
