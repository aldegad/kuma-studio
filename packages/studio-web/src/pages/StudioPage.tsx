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

  // Fit-to-screen: compute zoom & pan to show all characters
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
    const newPanX = (viewW - contentW * newZoom) / 2 - minX * newZoom;
    const newPanY = (viewH - contentH * newZoom) / 2 - minY * newZoom;

    setZoom(newZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  }, [scene.characters]);

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
  // Keyboard shortcuts: Ctrl+/- zoom, Ctrl+0 reset
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoom((z) => clamp(z * 1.2, ZOOM_MIN, ZOOM_MAX));
      } else if (e.key === "-") {
        e.preventDefault();
        setZoom((z) => clamp(z / 1.2, ZOOM_MIN, ZOOM_MAX));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoom(ZOOM_DEFAULT);
        setPanX(0);
        setPanY(0);
      } else if (e.key === "1") {
        e.preventDefault();
        fitToScreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitToScreen]);

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

  // Time-based ambient lighting (day/night cycle)
  const hour = new Date().getHours();
  const ambientBg =
    hour >= 6 && hour < 10 ? "linear-gradient(135deg, #fef3c7 0%, #fde68a 30%, #fef9ee 100%)" // morning
    : hour >= 10 && hour < 17 ? "linear-gradient(135deg, #fefce8 0%, #fef08a 30%, #fffbeb 100%)" // daytime
    : hour >= 17 && hour < 20 ? "linear-gradient(135deg, #fed7aa 0%, #fdba74 30%, #fff7ed 100%)" // sunset
    : "linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #1e1b4b 100%)"; // night
  const isNight = hour >= 20 || hour < 6;

  return (
    <div className="h-screen w-screen overflow-hidden relative select-none" style={{ background: ambientBg, transition: "background 60s ease" }}>

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
            transition: dragState ? "none" : "transform 0.2s ease-out",
          }}
        >
          <OfficeBackground background={scene.background} />

          {/* Team zone backgrounds — subtle colored regions */}
          <div className="absolute rounded-3xl pointer-events-none" style={{ left: 380, top: 20, width: 260, height: 160, background: "radial-gradient(ellipse, rgba(168,162,158,0.08) 0%, transparent 70%)" }} />
          <div className="absolute rounded-3xl pointer-events-none" style={{ left: 40, top: 100, width: 400, height: 350, background: "radial-gradient(ellipse, rgba(59,130,246,0.06) 0%, transparent 70%)" }} />
          <div className="absolute rounded-3xl pointer-events-none" style={{ left: 550, top: 100, width: 350, height: 250, background: "radial-gradient(ellipse, rgba(249,115,22,0.06) 0%, transparent 70%)" }} />
          <div className="absolute rounded-3xl pointer-events-none" style={{ left: 550, top: 320, width: 350, height: 250, background: "radial-gradient(ellipse, rgba(34,197,94,0.06) 0%, transparent 70%)" }} />

          {/* Team area labels */}
          <span className="absolute text-lg font-bold text-stone-300/50 select-none pointer-events-none" style={{ left: 470, top: 40 }}>총괄</span>
          <span className="absolute text-lg font-bold text-blue-300/50 select-none pointer-events-none" style={{ left: 100, top: 120 }}>🐺 개발팀</span>
          <span className="absolute text-lg font-bold text-orange-300/50 select-none pointer-events-none" style={{ left: 630, top: 120 }}>🦊 분석팀</span>
          <span className="absolute text-lg font-bold text-green-300/50 select-none pointer-events-none" style={{ left: 630, top: 340 }}>🦌 전략팀</span>

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
              speechBubble={
                PIPELINE_STAGE_ORDER.flatMap((s) => stages[s])
                  .find((a) => a.id === character.id && a.status === "working")
                  ?.currentTask
              }
              onDoubleClick={(event) => {
                event.stopPropagation();
                const container = containerRef.current;
                if (!container) return;
                const focusZoom = 1.2;
                const viewW = container.clientWidth;
                const viewH = container.clientHeight;
                setZoom(focusZoom);
                setPanX(viewW / 2 - character.position.x * focusZoom);
                setPanY(viewH / 2 - character.position.y * focusZoom);
              }}
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
      <div className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-2 backdrop-blur-md border-b shadow-sm ${isNight ? "bg-indigo-950/60 border-indigo-800/40" : "bg-white/60 border-white/40"}`}>
        {/* Logo + team count */}
        <div className="flex items-center gap-3">
          <span className={`text-lg font-black tracking-tight ${isNight ? "text-amber-200" : "text-amber-900"}`}>쿠마 스튜디오</span>
          <span className={`text-xs font-medium hidden sm:inline ${isNight ? "text-indigo-300" : "text-stone-400"}`}>가상 사무실</span>
          <span className="rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-2 py-0.5">{scene.characters.length}명</span>
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
      {/* Zoom controls — bottom-right                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="absolute bottom-4 right-4 z-40 flex items-center gap-1 bg-white/75 backdrop-blur-md rounded-full border border-white/50 shadow-lg px-2 py-1">
        <button onClick={() => setZoom(z => clamp(z * 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-600 text-sm font-bold">+</button>
        <span className="text-[10px] text-stone-500 font-medium min-w-[32px] text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => clamp(z / 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-600 text-sm font-bold">{"\u2212"}</button>
        <button onClick={() => { setZoom(ZOOM_DEFAULT); setPanX(0); setPanY(0); }} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-500 text-xs" title="초기화">{"\u21BA"}</button>
        <button onClick={fitToScreen} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-500 text-xs" title="전체 보기">{"\u2B1C"}</button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Skills Panel — bottom-right floating panel                          */}
      {/* ------------------------------------------------------------------ */}
      <SkillsPanel />

      {/* ------------------------------------------------------------------ */}
      {/* Minimap — bottom-left                                               */}
      {/* ------------------------------------------------------------------ */}
      {(() => {
        const MINIMAP_W = 140;
        const MINIMAP_H = MINIMAP_W * (CANVAS_HEIGHT / CANVAS_WIDTH);
        const scaleX = MINIMAP_W / CANVAS_WIDTH;
        const scaleY = MINIMAP_H / CANVAS_HEIGHT;
        const container = containerRef.current;
        const vpW = container ? container.clientWidth / zoom * scaleX : 40;
        const vpH = container ? container.clientHeight / zoom * scaleY : 30;
        const vpX = -panX / zoom * scaleX;
        const vpY = -panY / zoom * scaleY;
        return (
          <div
            className="absolute bottom-44 left-4 z-30 rounded-xl bg-white/75 backdrop-blur-md border border-white/50 shadow-lg p-1.5 cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = (e.clientX - rect.left - 6) / scaleX;
              const clickY = (e.clientY - rect.top - 6) / scaleY;
              const ctr = containerRef.current;
              if (!ctr) return;
              setPanX(ctr.clientWidth / 2 - clickX * zoom);
              setPanY(ctr.clientHeight / 2 - clickY * zoom);
            }}
          >
            <div className="relative overflow-hidden rounded-lg" style={{ width: MINIMAP_W, height: MINIMAP_H, background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)" }}>
              {/* Viewport rectangle */}
              <div className="absolute border border-blue-400/60 bg-blue-200/15 rounded-sm" style={{ left: clamp(vpX, 0, MINIMAP_W), top: clamp(vpY, 0, MINIMAP_H), width: Math.min(vpW, MINIMAP_W), height: Math.min(vpH, MINIMAP_H) }} />
              {/* Character dots */}
              {scene.characters.map((c) => (
                <div key={c.id} className="absolute w-2 h-2 rounded-full bg-stone-500/70" style={{ left: c.position.x * scaleX - 4, top: c.position.y * scaleY - 4 }} title={c.name} />
              ))}
            </div>
          </div>
        );
      })()}

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
