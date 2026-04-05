import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDailyReport, fetchJobCards, fetchOfficeLayout, fetchStats, saveOfficeLayout } from "../lib/api";
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
import { FURNITURE_SIZES, TEAM_ZONES, TEAM_POSITIONS, HIERARCHY_LINES, sceneToLayout } from "../lib/office-scene";
import { KUMA_TEAM, type AgentState } from "../types/agent";
import type { JobCard } from "../types/job-card";
import type { OfficePosition } from "../types/office";
import { OfficeBackground } from "../components/office/OfficeBackground";
import { Character } from "../components/office/Character";
import { Furniture } from "../components/office/Furniture";
import { Whiteboard } from "../components/office/Whiteboard";
import { SkillsPanel } from "../components/dashboard/SkillsPanel";
import { ReferencePanel } from "../components/dashboard/ReferencePanel";
import { DailyReportWidget } from "../components/dashboard/DailyReportWidget";
import { ToastContainer, pushToast } from "../components/shared/Toast";
import { ActivityFeed } from "../components/shared/ActivityFeed";
import { AmbientParticles } from "../components/office/AmbientParticles";
import { GitLogPanel } from "../components/dashboard/GitLogPanel";
import { PlanPanel } from "../components/dashboard/PlanPanel";
import { ClaudePlansCachePanel } from "../components/dashboard/ClaudePlansCachePanel";
import { MemoPanel } from "../components/dashboard/MemoPanel";
import { DraggableDashboard, type DashboardPanelItem } from "../components/dashboard/DraggableDashboard";
import { CharacterDetailPanel } from "../components/office/CharacterDetailPanel";
import { SettingsPanel } from "../components/office/SettingsPanel";
import { useActivityStore } from "../stores/use-activity-store";
import { FileExplorer } from "../components/ide/FileExplorer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: JobCard }
    | { kind: "agent-state-change"; agentId: string; state: AgentState; task?: string | null };
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
const GIT_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readStoredNumber(key: string, fallback: number, min?: number, max?: number) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  if (min != null || max != null) {
    return clamp(parsed, min ?? parsed, max ?? parsed);
  }

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
  const fetchGitActivity = useDashboardStore((state) => state.fetchGitActivity);
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

  // Zoom & pan state (restore from localStorage)
  const [zoom, setZoom] = useState(() => {
    return readStoredNumber("kuma-studio-zoom", ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX);
  });
  const [panX, setPanX] = useState(() => {
    return readStoredNumber("kuma-studio-panX", 0);
  });
  const [panY, setPanY] = useState(() => {
    return readStoredNumber("kuma-studio-panY", 0);
  });

  // Persist zoom/pan to localStorage
  useEffect(() => {
    localStorage.setItem("kuma-studio-zoom", String(zoom));
    localStorage.setItem("kuma-studio-panX", String(panX));
    localStorage.setItem("kuma-studio-panY", String(panY));
  }, [zoom, panX, panY]);

  // Pipeline HUD collapsed state
  const [pipelineCollapsed, setPipelineCollapsed] = useState(false);

  // Help overlay
  const [showHelp, setShowHelp] = useState(false);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [particlesEnabled, setParticlesEnabled] = useState(true);

  // IDE File Explorer
  const [explorerOpen, setExplorerOpen] = useState(false);

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
    const poll = async () => {
      try {
        const [s, report] = await Promise.all([fetchStats(), fetchDailyReport()]);
        if (!cancelled) { setStats(s); setDailyReport(report); }
      } catch { /* live via websocket */ }
    };
    void poll();
    const timer = setInterval(poll, 30_000); // refresh every 30s
    return () => { cancelled = true; clearInterval(timer); };
  }, [setDailyReport, setStats]);

  useEffect(() => {
    const refreshGitActivity = async () => {
      try {
        await fetchGitActivity();
      } catch {
        // Live updates over websocket will still refresh activity.
      }
    };

    void refreshGitActivity();
    const timer = setInterval(() => {
      void refreshGitActivity();
    }, GIT_ACTIVITY_REFRESH_MS);

    return () => clearInterval(timer);
  }, [fetchGitActivity]);

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
        if (ev.kind === "job-card-update") {
          syncJob(ev.card);
          const statusLabel = ev.card.status === "completed" ? "완료" : ev.card.status === "error" ? "오류" : "업데이트";
          pushToast(`${statusLabel}: ${ev.card.message?.slice(0, 40) || ev.card.id}`, ev.card.status === "error" ? "error" : ev.card.status === "completed" ? "success" : "info");
        } else if (ev.kind === "agent-state-change") {
          updateAgentState(ev.agentId, ev.state);
          const member = KUMA_TEAM.find((m) => m.id === ev.agentId);
          if (member) {
            const stateMsg: Record<string, string> = { working: "작업 시작", thinking: "생각 중", completed: "작업 완료", error: "오류 발생", idle: "대기 상태" };
            const eventType = ev.state === "error" ? "error" as const : ev.state === "completed" ? "task-complete" as const : ev.state === "working" ? "task-start" as const : "state-change" as const;
            useActivityStore.getState().push({
              agentId: ev.agentId,
              agentName: member.nameKo,
              emoji: member.emoji ?? "",
              type: eventType,
              message: stateMsg[ev.state] ?? ev.state,
            });
          }
        }
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
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setShowHelp(false);
        setSelectedCharId(null);
        return;
      }

      // Arrow keys for panning (no modifier needed)
      const PAN_STEP = 80;
      if (e.key === "ArrowLeft") { e.preventDefault(); setPanX((v) => v + PAN_STEP); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); setPanX((v) => v - PAN_STEP); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setPanY((v) => v + PAN_STEP); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setPanY((v) => v - PAN_STEP); return; }

      // F key for fit to screen
      if (e.key === "f" && !e.ctrlKey && !e.metaKey) { fitToScreen(); return; }

      // 1-4 to focus team zones (no modifier)
      if (!e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "4") {
        focusOnZone(Number(e.key) - 1);
        return;
      }

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
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitToScreen, focusOnZone]);

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
      setSelectedCharId(null); // deselect on canvas click
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

  const activityCount = useActivityStore((state) => state.events.length);

  const dashboardPanels: DashboardPanelItem[] = [
    {
      id: "daily-report",
      title: "일일 리포트",
      className: "w-80",
      content: <DailyReportWidget compact isNight={isNight} />,
    },
    {
      id: "plan-panel",
      title: "계획 진행률",
      className: "w-72",
      content: <PlanPanel isNight={isNight} />,
    },
    {
      id: "claude-plans-cache",
      title: "Claude Plans Cache",
      className: "w-72",
      content: <ClaudePlansCachePanel isNight={isNight} />,
    },
    {
      id: "git-log",
      title: "커밋 로그",
      className: "w-72",
      content: <GitLogPanel isNight={isNight} />,
    },
    {
      id: "memo",
      title: "메모",
      className: "w-80",
      content: <MemoPanel isNight={isNight} />,
    },
    {
      id: "activity-feed",
      title: "활동 로그",
      className: "w-72",
      content: <ActivityFeed />,
      hidden: activityCount === 0,
    },
    {
      id: "skills",
      title: "스킬",
      className: "w-80",
      content: <SkillsPanel />,
    },
    {
      id: "reference",
      title: "참고문서",
      content: <ReferencePanel />,
      className: "w-[min(34rem,calc(100vw-2rem))]",
    },
    {
      id: "pipeline",
      title: "파이프라인",
      className: "w-72",
      defaultPosition: ({ width }) => ({
        x: Math.max(width - 304, 16),
        y: 56,
      }),
      content: (
        <div className="rounded-2xl bg-white/75 backdrop-blur-md border border-white/50 shadow-lg overflow-hidden">
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
              <div className="flex items-center gap-1">
                {PIPELINE_STAGE_ORDER.map((stageId, idx) => {
                  const meta = stageMeta[stageId];
                  const activeCount = stages[stageId].filter((agent) => agent.status !== "idle").length;
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

              {PIPELINE_STAGE_ORDER.flatMap((stageId) =>
                stages[stageId]
                  .filter((agent) => agent.status !== "idle")
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

              {PIPELINE_STAGE_ORDER.every((stageId) => stages[stageId].every((agent) => agent.status === "idle")) && (
                <p className="text-center text-[10px] text-stone-400 py-1">활성 작업 없음</p>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "job-status",
      title: "작업 현황",
      className: "w-[min(20rem,calc(100vw-2rem))]",
      defaultPosition: ({ height }) => ({
        x: 16,
        y: Math.max(height - 230, 120),
      }),
      content: (
        <div className="space-y-2">
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
      ),
    },
    {
      id: "minimap",
      title: "미니맵",
      className: "w-[152px]",
      defaultPosition: ({ height }) => ({
        x: 16,
        y: Math.max(height - 308, 72),
      }),
      content: (() => {
        const minimapWidth = 140;
        const minimapHeight = minimapWidth * (CANVAS_HEIGHT / CANVAS_WIDTH);
        const scaleX = minimapWidth / CANVAS_WIDTH;
        const scaleY = minimapHeight / CANVAS_HEIGHT;
        const container = containerRef.current;
        const viewportWidth = container ? container.clientWidth / zoom * scaleX : 40;
        const viewportHeight = container ? container.clientHeight / zoom * scaleY : 30;
        const viewportX = -panX / zoom * scaleX;
        const viewportY = -panY / zoom * scaleY;

        return (
          <div
            role="button"
            tabIndex={0}
            className="rounded-xl bg-white/75 backdrop-blur-md border border-white/50 shadow-lg p-1.5 cursor-pointer outline-none"
            aria-label="미니맵에서 위치 이동"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const clickX = (event.clientX - rect.left - 6) / scaleX;
              const clickY = (event.clientY - rect.top - 6) / scaleY;
              const containerElement = containerRef.current;
              if (!containerElement) return;
              setPanX(containerElement.clientWidth / 2 - clickX * zoom);
              setPanY(containerElement.clientHeight / 2 - clickY * zoom);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }

              event.preventDefault();
              fitToScreen();
            }}
          >
            <div className="relative overflow-hidden rounded-lg" style={{ width: minimapWidth, height: minimapHeight, background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)" }}>
              <svg className="absolute inset-0 pointer-events-none" width={minimapWidth} height={minimapHeight}>
                {HIERARCHY_LINES.map(({ from, to, color }) => {
                  const fromPosition = TEAM_POSITIONS[from];
                  const toPosition = TEAM_POSITIONS[to];
                  if (!fromPosition || !toPosition) return null;

                  return (
                    <line
                      key={`mini-${from}-${to}`}
                      x1={fromPosition.x * scaleX}
                      y1={fromPosition.y * scaleY}
                      x2={toPosition.x * scaleX}
                      y2={toPosition.y * scaleY}
                      stroke={color}
                      strokeWidth={1}
                      opacity={0.5}
                    />
                  );
                })}
              </svg>

              <div
                className="absolute border border-blue-400/60 bg-blue-200/15 rounded-sm"
                style={{
                  left: clamp(viewportX, 0, minimapWidth),
                  top: clamp(viewportY, 0, minimapHeight),
                  width: Math.min(viewportWidth, minimapWidth),
                  height: Math.min(viewportHeight, minimapHeight),
                }}
              />

              {scene.characters.map((character) => {
                const member = KUMA_TEAM.find((agent) => agent.id === character.id);
                const team = member?.team;
                const dotColor = team === "dev" ? "#3b82f6" : team === "analytics" ? "#f97316" : team === "strategy" ? "#22c55e" : "#78716c";
                const isActive = character.state === "working" || character.state === "thinking";

                return (
                  <div key={character.id} className="absolute" style={{ left: character.position.x * scaleX - 4, top: character.position.y * scaleY - 4 }}>
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${isActive ? "animate-pulse" : ""}`}
                      style={{ backgroundColor: dotColor, opacity: isActive ? 1 : 0.7, boxShadow: isActive ? `0 0 4px ${dotColor}` : "none" }}
                      title={`${member?.emoji ?? ""} ${character.name} — ${character.state}`}
                    />
                    <span className="absolute left-3 top-[-2px] text-[5px] font-medium text-stone-600 whitespace-nowrap pointer-events-none">
                      {member?.emoji ?? ""}{member?.nameKo?.[0] ?? character.name[0]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })(),
    },
    {
      id: "whiteboard",
      title: "작업 보드",
      className: "w-64",
      defaultPosition: { x: 290, y: 30 },
      content: <Whiteboard />,
    },
  ];

  return (
    <div className="h-screen w-screen overflow-hidden relative select-none" style={{ background: ambientBg, transition: "background 60s ease" }}>

      {/* Ambient particles — subtle floating effect */}
      {particlesEnabled && <AmbientParticles isNight={isNight} />}

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
          <OfficeBackground background={scene.background} isNight={isNight} />

          {/* Team zone backgrounds — data-driven from TEAM_ZONES */}
          {TEAM_ZONES.map((zone) => (
            <div
              key={zone.team}
              className="absolute rounded-3xl pointer-events-none"
              style={{
                left: zone.x,
                top: zone.y,
                width: zone.w,
                height: zone.h,
                background: `radial-gradient(ellipse, ${zone.color} 0%, transparent 70%)`,
              }}
            />
          ))}

          {/* Team area labels */}
          {TEAM_ZONES.map((zone) => {
            const teamEmoji: Record<string, string> = { dev: "🐺", analytics: "🦊", strategy: "🦌" };
            const labelColor: Record<string, string> = { management: "text-stone-300/50", dev: "text-blue-300/50", analytics: "text-orange-300/50", strategy: "text-green-300/50" };
            return (
              <span
                key={`label-${zone.team}`}
                className={`absolute text-lg font-bold select-none pointer-events-none ${labelColor[zone.team] ?? "text-stone-300/50"}`}
                style={{ left: zone.x + 20, top: zone.y + 10 }}
              >
                {teamEmoji[zone.team] ? `${teamEmoji[zone.team]} ` : ""}{zone.label}
              </span>
            );
          })}

          {/* SVG hierarchy connection lines — glow when either endpoint is active */}
          <svg className="absolute inset-0 pointer-events-none" width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
            {HIERARCHY_LINES.map(({ from, to, color }) => {
              const fromPos = TEAM_POSITIONS[from];
              const toPos = TEAM_POSITIONS[to];
              if (!fromPos || !toPos) return null;
              const midY = (fromPos.y + toPos.y) / 2;
              const fromChar = scene.characters.find((c) => c.id === from);
              const toChar = scene.characters.find((c) => c.id === to);
              const isActive = fromChar?.state === "working" || fromChar?.state === "thinking" || toChar?.state === "working" || toChar?.state === "thinking";
              return (
                <path
                  key={`${from}-${to}`}
                  d={`M ${fromPos.x} ${fromPos.y + 20} C ${fromPos.x} ${midY}, ${toPos.x} ${midY}, ${toPos.x} ${toPos.y - 20}`}
                  stroke={color}
                  strokeWidth={isActive ? 3 : 2}
                  fill="none"
                  strokeDasharray={isActive ? "none" : "6 4"}
                  opacity={isActive ? 0.9 : 0.5}
                  style={isActive ? { filter: `drop-shadow(0 0 4px ${color.replace(/[\d.]+\)$/, "0.5)")})` } : undefined}
                >
                  {isActive && (
                    <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />
                  )}
                </path>
              );
            })}
          </svg>

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
              isSelected={selectedCharId === character.id}
              speechBubble={
                PIPELINE_STAGE_ORDER.flatMap((s) => stages[s])
                  .find((a) => a.id === character.id && a.status === "working")
                  ?.currentTask
              }
              onClick={(event) => {
                event.stopPropagation();
                setSelectedCharId((prev) => prev === character.id ? null : character.id);
              }}
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
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isNight ? "bg-indigo-800 text-indigo-300" : "bg-sky-100 text-sky-700"}`}>
            {isNight ? "🌙" : hour < 12 ? "☀️" : "🌤️"} {String(hour).padStart(2, "0")}:{String(new Date().getMinutes()).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className={`rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold ${isNight ? "bg-indigo-800 text-indigo-300 hover:bg-indigo-700" : "bg-stone-100 text-stone-400 hover:bg-stone-200"}`}
            title="단축키 도움말 (?)"
            aria-label="단축키 도움말 열기"
          >
            ?
          </button>
          <button
            type="button"
            onClick={() => setExplorerOpen((v) => !v)}
            className={`rounded-full h-5 flex items-center justify-center text-[10px] font-bold px-2 ${
              explorerOpen
                ? isNight ? "bg-amber-700 text-amber-200" : "bg-amber-100 text-amber-700"
                : isNight ? "bg-indigo-800 text-indigo-300 hover:bg-indigo-700" : "bg-stone-100 text-stone-400 hover:bg-stone-200"
            }`}
            title="파일 탐색기 토글"
            aria-label="파일 탐색기 열기/닫기"
          >
            {explorerOpen ? "✕ 파일" : "📂 파일"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <SettingsPanel
            className="shrink-0"
            isNight={isNight}
            animationsEnabled={animationsEnabled}
            onToggleAnimations={() => setAnimationsEnabled((v) => !v)}
            particlesEnabled={particlesEnabled}
            onToggleParticles={() => setParticlesEnabled((v) => !v)}
          />
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
      </div>

      {/* IDE File Explorer — split-pane: file tree + inline viewer */}
      {explorerOpen && (
        <div className="absolute left-0 top-10 bottom-0 z-40" style={{ maxWidth: "min(900px, 60vw)" }}>
          <FileExplorer
            onCollapse={() => setExplorerOpen(false)}
          />
        </div>
      )}

      {/* Toast notifications */}
      <ToastContainer />

      {/* Floating dashboard panels */}
      <DraggableDashboard panels={dashboardPanels} />

      {/* Character detail panel */}
      {selectedCharId && (() => {
        const char = scene.characters.find((c) => c.id === selectedCharId);
        return char ? <CharacterDetailPanel character={char} isNight={isNight} onClose={() => setSelectedCharId(null)} /> : null;
      })()}
      {/* ------------------------------------------------------------------ */}
      {/* Zoom controls — bottom-right                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="absolute bottom-4 right-4 z-40 flex items-center gap-1 bg-white/75 backdrop-blur-md rounded-full border border-white/50 shadow-lg px-2 py-1">
        <button type="button" onClick={() => setZoom(z => clamp(z * 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-600 text-sm font-bold" aria-label="줌 인">+</button>
        <span className="text-[10px] text-stone-500 font-medium min-w-[32px] text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(z => clamp(z / 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-600 text-sm font-bold" aria-label="줌 아웃">{"\u2212"}</button>
        <button type="button" onClick={() => { setZoom(ZOOM_DEFAULT); setPanX(0); setPanY(0); }} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-500 text-xs" title="초기화" aria-label="줌과 위치 초기화">{"\u21BA"}</button>
        <button type="button" onClick={fitToScreen} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-500 text-xs" title="전체 보기" aria-label="전체 보기">{"\u2B1C"}</button>
      </div>
      {/* Zoom controls — bottom-left above minimap */}
      <div className="absolute bottom-[17rem] left-4 z-30 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setZoom((z) => clamp(z * 1.3, ZOOM_MIN, ZOOM_MAX))}
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-md transition-colors ${
            isNight ? "bg-indigo-900/80 text-indigo-300 hover:bg-indigo-800" : "bg-white/80 text-stone-600 hover:bg-white"
          } backdrop-blur-md border ${isNight ? "border-indigo-700/40" : "border-white/50"}`}
          title="줌 인"
          aria-label="줌 인"
        >+</button>
        <button
          type="button"
          onClick={() => setZoom((z) => clamp(z / 1.3, ZOOM_MIN, ZOOM_MAX))}
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-md transition-colors ${
            isNight ? "bg-indigo-900/80 text-indigo-300 hover:bg-indigo-800" : "bg-white/80 text-stone-600 hover:bg-white"
          } backdrop-blur-md border ${isNight ? "border-indigo-700/40" : "border-white/50"}`}
          title="줌 아웃"
          aria-label="줌 아웃"
        >−</button>
        <button
          type="button"
          onClick={fitToScreen}
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shadow-md transition-colors ${
            isNight ? "bg-indigo-900/80 text-indigo-300 hover:bg-indigo-800" : "bg-white/80 text-stone-600 hover:bg-white"
          } backdrop-blur-md border ${isNight ? "border-indigo-700/40" : "border-white/50"}`}
          title="전체 보기 (F)"
          aria-label="전체 보기"
        >⊞</button>
      </div>

      {/* Help overlay */}
      {showHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="studio-help-dialog-title"
            className="rounded-2xl bg-white/95 backdrop-blur-md shadow-2xl p-6 max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="studio-help-dialog-title" className="text-sm font-bold text-stone-800 mb-3">키보드 단축키</h2>
            <div className="space-y-1.5 text-xs text-stone-600">
              {[
                ["Ctrl + =", "줌 인"],
                ["Ctrl + -", "줌 아웃"],
                ["Ctrl + 0", "줌 초기화"],
                ["F", "전체 보기"],
                ["1", "총괄 포커스"],
                ["2", "개발팀 포커스"],
                ["3", "분석팀 포커스"],
                ["4", "전략팀 포커스"],
                ["← → ↑ ↓", "캔버스 이동"],
                ["드래그", "캔버스 이동"],
                ["휠", "커서 중심 줌"],
                ["더블클릭", "캐릭터 포커스"],
                ["?", "이 도움말 토글"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <kbd className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-stone-700">{key}</kbd>
                  <span className="text-stone-500">{desc}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-stone-400 text-center">ESC 또는 배경 클릭으로 닫기</p>
          </div>
        </div>
      )}
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
