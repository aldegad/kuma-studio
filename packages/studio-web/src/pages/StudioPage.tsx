import { useEffect, useRef, useState } from "react";
import { fetchDailyReport, fetchOfficeLayout, fetchStats } from "../lib/api";
import { useWebSocket } from "../hooks/use-websocket";
import { useDashboardStore } from "../stores/use-dashboard-store";
import { useOfficeStore } from "../stores/use-office-store";
import { useTeamStatusStore } from "../stores/use-team-status-store";
import { useWsStore } from "../stores/use-ws-store";
import { TEAM_POSITIONS, HIERARCHY_LINES } from "../lib/office-scene";
import { KUMA_TEAM, type AgentState } from "../types/agent";
import type { JobCard } from "../types/job-card";
import { OfficeBackground } from "../components/office/OfficeBackground";
import { Character } from "../components/office/Character";
import { Furniture } from "../components/office/Furniture";
import { Whiteboard } from "../components/office/Whiteboard";
import { SkillsPanel } from "../components/dashboard/SkillsPanel";
import { ToastContainer, pushToast } from "../components/shared/Toast";
import { ActivityFeed } from "../components/shared/ActivityFeed";
import { AmbientParticles } from "../components/office/AmbientParticles";
import { GitLogPanel } from "../components/dashboard/GitLogPanel";
import { PlanPanel } from "../components/dashboard/PlanPanel";
import { MemoPanel } from "../components/dashboard/MemoPanel";
import { ContentPanel } from "../components/dashboard/ContentPanel";
import { ExperimentPanel } from "../components/dashboard/ExperimentPanel";
import { DraggableDashboard, type DashboardPanelItem } from "../components/dashboard/DraggableDashboard";
import { CharacterDetailPanel } from "../components/office/CharacterDetailPanel";
import { SettingsPanel } from "../components/office/SettingsPanel";
import { useActivityStore } from "../stores/use-activity-store";
import { FileExplorer } from "../components/ide/FileExplorer";
import { useCanvasInteraction, CANVAS_WIDTH, CANVAS_HEIGHT, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX, clamp } from "../hooks/use-canvas-interaction";

interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: JobCard }
    | { kind: "agent-state-change"; agentId: string; state: AgentState; task?: string | null };
}

const GIT_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

export function StudioPage() {
  const { status } = useWebSocket();
  const ws = useWsStore((s) => s.ws);

  // Dashboard store
  const stats = useDashboardStore((s) => s.stats);
  const setStats = useDashboardStore((s) => s.setStats);
  const setDailyReport = useDashboardStore((s) => s.setDailyReport);
  const fetchGitActivity = useDashboardStore((s) => s.fetchGitActivity);
  const jobs = useDashboardStore((s) => s.jobs);

  // Office store
  const scene = useOfficeStore((s) => s.scene);
  const applyLayout = useOfficeStore((s) => s.applyLayout);
  const activeLayout = useOfficeStore((s) => s.activeLayout);
  const switchProject = useOfficeStore((s) => s.switchProject);

  // Team status — project tabs + live member states
  const projects = useTeamStatusStore((s) => s.projects);
  const activeProjectId = useTeamStatusStore((s) => s.activeProjectId);
  const setActiveProject = useTeamStatusStore((s) => s.setActiveProject);
  const memberStatus = useTeamStatusStore((s) => s.memberStatus);

  // Canvas interaction
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    dragState, setDragState,
    zoom, setZoom,
    panX, panY,
    fitToScreen,
    handleCanvasMouseDown,
  } = useCanvasInteraction(containerRef);

  // UI state
  const [showHelp, setShowHelp] = useState(false);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(false);

  // Keyboard: help & escape (canvas keys handled in hook)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); setShowHelp((v) => !v); }
      if (e.key === "Escape") { setShowHelp(false); setSelectedCharId(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [s, report] = await Promise.all([fetchStats(), fetchDailyReport()]);
        if (!cancelled) { setStats(s); setDailyReport(report); }
      } catch { /* live via websocket */ }
    };
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [setDailyReport, setStats]);

  useEffect(() => {
    const refresh = async () => { try { await fetchGitActivity(); } catch {} };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, GIT_ACTIVITY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchGitActivity]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try { const layout = await fetchOfficeLayout(); if (!cancelled) applyLayout(layout); }
      catch { /* keep local */ }
    })();
    return () => { cancelled = true; };
  }, [applyLayout]);

  useEffect(() => {
    if (!ws) return;
    const handleMessage = (e: MessageEvent) => {
      try {
        const data: StudioEvent = JSON.parse(e.data as string);
        if (data.type !== "kuma-studio:event") return;
        const ev = data.event;
        if (ev.kind === "job-card-update") {
          const sl = ev.card.status === "completed" ? "완료" : ev.card.status === "error" ? "오류" : "업데이트";
          pushToast(`${sl}: ${ev.card.message?.slice(0, 40) || ev.card.id}`, ev.card.status === "error" ? "error" : ev.card.status === "completed" ? "success" : "info");
        } else if (ev.kind === "agent-state-change") {
          const member = KUMA_TEAM.find((m) => m.id === ev.agentId);
          if (member) {
            const stateMsg: Record<string, string> = { working: "작업 시작", thinking: "생각 중", completed: "작업 완료", error: "오류 발생", idle: "대기 상태" };
            const eventType = ev.state === "error" ? "error" as const : ev.state === "completed" ? "task-complete" as const : ev.state === "working" ? "task-start" as const : "state-change" as const;
            useActivityStore.getState().push({ agentId: ev.agentId, agentName: member.nameKo, emoji: member.emoji ?? "", type: eventType, message: stateMsg[ev.state] ?? ev.state });
          }
        }
      } catch { /* ignore */ }
    };
    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws]);

  const hour = new Date().getHours();
  const ambientBg =
    hour >= 6 && hour < 10 ? "linear-gradient(135deg, #fef3c7 0%, #fde68a 30%, #fef9ee 100%)"
    : hour >= 10 && hour < 17 ? "linear-gradient(135deg, #fefce8 0%, #fef08a 30%, #fffbeb 100%)"
    : hour >= 17 && hour < 20 ? "linear-gradient(135deg, #fed7aa 0%, #fdba74 30%, #fff7ed 100%)"
    : "linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #1e1b4b 100%)";
  const isNight = hour >= 20 || hour < 6;

  const activityCount = useActivityStore((s) => s.events.length);

  // "system" project members (e.g. jjooni) are always visible regardless of active tab
  const systemMemberIds = projects.find((p) => p.projectId === "system")?.members.map((m) => m.id) ?? [];
  const systemMemberIdSet = new Set(systemMemberIds);
  const activeProjectMemberIds = activeProjectId
    ? [
        ...(projects.find((p) => p.projectId === activeProjectId)?.members.map((m) => m.id) ?? []),
        ...systemMemberIds,
      ]
    : null;
  const activeProjectMemberIdsKey = activeProjectMemberIds?.join("|") ?? "__all__";

  // Switch office layout when active project changes
  useEffect(() => {
    if (activeProjectMemberIds && activeProjectMemberIds.length > 0) {
      switchProject(activeProjectMemberIds);
    } else {
      switchProject(null);
    }
  }, [activeProjectMemberIdsKey, switchProject]);

  // Filter characters by active project (system members always included)
  const visibleCharacters = activeProjectId
    ? scene.characters.filter((c) => {
        if (systemMemberIdSet.has(c.id)) return true;
        const projectMembers = projects.find((p) => p.projectId === activeProjectId)?.members;
        if (!projectMembers) return true;
        return projectMembers.some((m) => m.id === c.id);
      })
    : scene.characters;

  // Active project name for office header
  const activeProjectName = activeProjectId
    ? projects.find((p) => p.projectId === activeProjectId)?.projectName ?? activeProjectId
    : null;

  const dashboardPanels: DashboardPanelItem[] = [
    { id: "plan-panel", title: "계획 진행률", className: "w-72", content: <PlanPanel /> },
    { id: "git-log", title: "커밋 로그", className: "w-72", content: <GitLogPanel /> },
    { id: "memo", title: "메모", className: "w-80", content: <MemoPanel /> },
    { id: "content", title: "스레드 콘텐츠", className: "w-[min(36rem,calc(100vw-2rem))]", content: <ContentPanel activeProjectId={activeProjectId} /> },
    { id: "experiment", title: "실험 파이프라인", className: "w-[min(42rem,calc(100vw-2rem))]", content: <ExperimentPanel /> },
    { id: "activity-feed", title: "활동 로그", className: "w-72", content: <ActivityFeed />, hidden: activityCount === 0 },
    { id: "skills", title: "스킬", className: "w-80", content: <SkillsPanel /> },
    { id: "job-status", title: "작업 현황", className: "w-[min(20rem,calc(100vw-2rem))]",
      defaultPosition: ({ height }) => ({ x: 16, y: Math.max(height - 230, 120) }),
      content: <JobStatusHud stats={stats} jobs={jobs} />,
    },
    { id: "minimap", title: "미니맵", className: "w-[152px]",
      defaultPosition: ({ height }) => ({ x: 16, y: Math.max(height - 308, 72) }),
      content: <Minimap scene={scene} />,
    },
    { id: "whiteboard", title: "작업 보드", className: "w-64", defaultPosition: { x: 290, y: 30 }, content: <Whiteboard /> },
  ];

  return (
    <div className={`h-screen w-screen overflow-hidden relative${dragState ? " select-none" : ""}`} data-theme={isNight ? "night" : "day"} style={{ background: ambientBg, transition: "background 60s ease" }}>
      {particlesEnabled && <AmbientParticles isNight={isNight} />}

      {/* Office canvas */}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden select-none" onMouseDown={(e) => { setSelectedCharId(null); handleCanvasMouseDown(e); }} style={{ cursor: dragState?.kind === "pan" ? "grabbing" : "grab" }}>
        <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, transformOrigin: "0 0", transition: dragState ? "none" : "transform 0.2s ease-out" }}>
          <OfficeBackground background={scene.background} isNight={isNight} />

          {/* Project name plate — shown when a specific project is active */}
          {activeProjectName && (
            <div className="absolute pointer-events-none" style={{ left: CANVAS_WIDTH / 2, top: 38, transform: "translateX(-50%)" }}>
              <div className="project-name-plate flex items-center gap-2 rounded-lg px-5 py-1.5"
                style={{
                  background: "linear-gradient(135deg, rgba(120, 80, 40, 0.85) 0%, rgba(90, 60, 30, 0.9) 100%)",
                  border: "2px solid rgba(200, 170, 120, 0.4)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 220, 160, 0.15)",
                }}>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200/90"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
                  {activeProjectName}
                </span>
                <span className="text-[9px] text-amber-300/50 font-medium">
                  {visibleCharacters.length}명
                </span>
              </div>
            </div>
          )}

          {/* Team zone backgrounds — no labels */}
          {activeLayout.teamZones.map((zone) => (
            <div key={zone.team} className="absolute rounded-3xl pointer-events-none" style={{ left: zone.x, top: zone.y, width: zone.w, height: zone.h, background: `radial-gradient(ellipse, ${zone.color} 0%, transparent 70%)` }} />
          ))}

          {/* Hierarchy lines */}
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
                <path key={`${from}-${to}`} d={`M ${fromPos.x} ${fromPos.y + 20} C ${fromPos.x} ${midY}, ${toPos.x} ${midY}, ${toPos.x} ${toPos.y - 20}`} stroke={color} strokeWidth={isActive ? 3 : 2} fill="none" strokeDasharray={isActive ? "none" : "6 4"} opacity={isActive ? 0.9 : 0.5} style={isActive ? { filter: `drop-shadow(0 0 4px ${color.replace(/[\d.]+\)$/, "0.5)")})` } : undefined}>
                  {isActive && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />}
                </path>
              );
            })}
          </svg>

          {scene.furniture.map((item) => (
            <Furniture key={item.id} furniture={item} isDragging={dragState?.kind === "furniture" && dragState.id === item.id}
              onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); setDragState({ kind: "furniture", id: item.id, offsetX: (event.clientX - r.left) / zoom - event.currentTarget.offsetWidth / 2, offsetY: (event.clientY - r.top) / zoom - event.currentTarget.offsetHeight / 2 }); }} />
          ))}

          {visibleCharacters.map((character) => (
            <Character key={character.id} character={character} isDragging={dragState?.kind === "character" && dragState.id === character.id} isSelected={selectedCharId === character.id}
              speechBubble={(character.state === "working" || character.state === "thinking") ? (memberStatus.get(character.id)?.task ?? character.task ?? undefined) : undefined}
              onClick={(event) => { event.stopPropagation(); setSelectedCharId((prev) => prev === character.id ? null : character.id); }}
              onDoubleClick={(event) => { event.stopPropagation(); const container = containerRef.current; if (!container) return; const focusZoom = 1.2; setZoom((_z) => focusZoom); /* setPanX/Y handled by zoom setter would need direct — simplified via inline */ }}
              onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); setDragState({ kind: "character", id: character.id, offsetX: (event.clientX - r.left) / zoom - event.currentTarget.offsetWidth / 2, offsetY: (event.clientY - r.top) / zoom - event.currentTarget.offsetHeight / 2 }); }} />
          ))}
        </div>
      </div>

      {/* Top bar — Game HUD */}
      <div className="game-hud-bar absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-lg font-black tracking-tight text-amber-200" style={{ textShadow: "0 0 12px rgba(255, 200, 100, 0.4), 0 1px 3px rgba(0,0,0,0.4)" }}>쿠마 스튜디오</span>
          <span className="rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-semibold px-2 py-0.5 border border-amber-400/25">{visibleCharacters.length}명</span>

          {/* Project tabs — zone selector */}
          {projects.length > 1 && (
            <div className="flex items-center gap-0.5 ml-2">
              <button type="button" onClick={() => setActiveProject(null)}
                className={`rounded px-2.5 py-0.5 text-[10px] font-semibold transition-colors border ${activeProjectId === null ? "bg-amber-500/30 text-amber-100 border-amber-400/40" : "bg-white/5 text-amber-300/60 border-transparent hover:bg-white/10 hover:text-amber-200"}`}>
                전체
              </button>
              {projects.map((p) => (
                <button key={p.projectId} type="button" onClick={() => setActiveProject(p.projectId)}
                  className={`rounded px-2.5 py-0.5 text-[10px] font-semibold transition-colors border ${activeProjectId === p.projectId ? "bg-amber-500/30 text-amber-100 border-amber-400/40" : "bg-white/5 text-amber-300/60 border-transparent hover:bg-white/10 hover:text-amber-200"}`}>
                  {p.projectName}
                </button>
              ))}
            </div>
          )}

          <span className="rounded px-2 py-0.5 text-[10px] font-medium bg-white/8 text-amber-200/80 border border-white/10">
            {isNight ? "🌙" : hour < 12 ? "☀️" : "🌤️"} {String(hour).padStart(2, "0")}:{String(new Date().getMinutes()).padStart(2, "0")}
          </span>
          <button type="button" onClick={() => setShowHelp(true)} className="rounded w-5 h-5 flex items-center justify-center text-[10px] font-bold bg-white/8 text-amber-200/70 border border-white/10 hover:bg-white/15 hover:text-amber-100" title="단축키 도움말 (?)" aria-label="단축키 도움말 열기">?</button>
          <button type="button" onClick={() => setExplorerOpen((v) => !v)} className={`rounded h-5 flex items-center justify-center text-[10px] font-bold px-2 border transition-colors ${explorerOpen ? "bg-amber-500/30 text-amber-100 border-amber-400/30" : "bg-white/8 text-amber-200/70 border-white/10 hover:bg-white/15 hover:text-amber-100"}`} title="파일 탐색기 토글" aria-label="파일 탐색기 열기/닫기">{explorerOpen ? "✕ 파일" : "📂 파일"}</button>
        </div>
        <div className="flex items-center gap-2">
          <SettingsPanel className="shrink-0" isNight={isNight} animationsEnabled={animationsEnabled} onToggleAnimations={() => setAnimationsEnabled((v) => !v)} particlesEnabled={particlesEnabled} onToggleParticles={() => setParticlesEnabled((v) => !v)} />
          <div className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium border ${status === "connected" ? "bg-green-500/15 text-green-300 border-green-500/25" : status === "connecting" ? "bg-amber-500/15 text-amber-300 border-amber-500/25" : "bg-red-500/15 text-red-300 border-red-500/25"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status === "connected" ? "bg-green-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : "bg-red-400"}`} />
            {status === "connected" ? "연결됨" : status === "connecting" ? "연결 중..." : "연결 끊김"}
          </div>
        </div>
      </div>

      {/* File Explorer */}
      {explorerOpen && (
        <div className="absolute left-0 top-10 bottom-0 z-40" style={{ maxWidth: "min(900px, 60vw)" }}>
          <FileExplorer onCollapse={() => setExplorerOpen(false)} />
        </div>
      )}

      <ToastContainer />
      <DraggableDashboard panels={dashboardPanels} />

      {selectedCharId && (() => {
        const char = scene.characters.find((c) => c.id === selectedCharId);
        return char ? <CharacterDetailPanel character={char} isNight={isNight} onClose={() => setSelectedCharId(null)} /> : null;
      })()}

      {/* Zoom controls — game style */}
      <div className="game-zoom-bar absolute bottom-4 right-4 z-40 flex items-center gap-1 rounded-lg px-2 py-1">
        <button type="button" onClick={() => setZoom(clamp(zoom * 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/80 text-sm font-bold" aria-label="줌 인">+</button>
        <span className="text-[10px] text-amber-200/60 font-medium min-w-[32px] text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(clamp(zoom / 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/80 text-sm font-bold" aria-label="줌 아웃">{"\u2212"}</button>
        <button type="button" onClick={() => { setZoom(ZOOM_DEFAULT); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/60 text-xs" title="초기화" aria-label="줌과 위치 초기화">{"\u21BA"}</button>
        <button type="button" onClick={fitToScreen} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/60 text-xs" title="전체 보기" aria-label="전체 보기">{"\u2B1C"}</button>
      </div>

      {/* Help overlay */}
      {showHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="help-title" className="game-panel-frame overflow-hidden rounded-xl max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="game-panel-titlebar flex items-center gap-1.5 px-4 py-2">
              <span className="w-1.5 h-1.5 rounded-sm bg-amber-400/50" />
              <h2 id="help-title" className="game-panel-title text-[10px] font-black uppercase tracking-[0.15em]">키보드 단축키</h2>
            </div>
            <div className="p-5 space-y-1.5 text-xs" style={{ color: "var(--t-secondary)" }}>
              {[["Ctrl + =", "줌 인"], ["Ctrl + -", "줌 아웃"], ["Ctrl + 0", "줌 초기화"], ["F", "전체 보기"], ["1-4", "팀 포커스"], ["← → ↑ ↓", "캔버스 이동"], ["드래그", "캔버스 이동"], ["휠", "커서 중심 줌"], ["더블클릭", "캐릭터 포커스"], ["?", "도움말 토글"]].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <kbd className="rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--t-primary)" }}>{key}</kbd>
                  <span style={{ color: "var(--t-muted)" }}>{desc}</span>
                </div>
              ))}
            </div>
            <p className="pb-3 text-[10px] text-center" style={{ color: "var(--t-faint)" }}>ESC 또는 배경 클릭으로 닫기</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (extracted to keep StudioPage concise)
// ---------------------------------------------------------------------------

function JobStatusHud({ stats, jobs }: { stats: ReturnType<typeof useDashboardStore.getState>["stats"]; jobs: JobCard[] }) {
  return (
    <div className="space-y-2">
      <div className="rounded-2xl backdrop-blur-md shadow-lg px-4 py-3" style={{ background: "var(--panel-bg)", borderWidth: 1, borderColor: "var(--panel-border)" }}>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--t-muted)" }}>작업 현황</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <StatBadge label="전체" value={stats.totalJobs} color="var(--t-secondary)" />
          <StatBadge label="진행" value={stats.inProgressJobs} color="#2563eb" dot="bg-blue-400" />
          <StatBadge label="완료" value={stats.completedJobs} color="#15803d" dot="bg-green-400" />
          <StatBadge label="오류" value={stats.errorJobs} color="#dc2626" dot="bg-red-400" />
        </div>
      </div>
      {jobs.length > 0 && (
        <div className="rounded-2xl backdrop-blur-md shadow-lg px-4 py-2" style={{ background: "var(--panel-bg)", borderWidth: 1, borderColor: "var(--panel-border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--t-muted)" }}>최근 작업</p>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${job.status === "completed" ? "bg-green-400" : job.status === "error" ? "bg-red-400" : job.status === "in_progress" ? "bg-blue-400" : "bg-stone-300"}`} />
                <p className="text-[9px] truncate max-w-[160px]" style={{ color: "var(--t-secondary)" }}>{job.message || job.id}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBadge({ label, value, color, dot }: { label: string; value: number; color: string; dot?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {dot && <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />}
      <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>{label}</span>
      <span className="text-xs font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function Minimap({ scene }: { scene: ReturnType<typeof useOfficeStore.getState>["scene"] }) {
  const minimapWidth = 140;
  const minimapHeight = minimapWidth * (CANVAS_HEIGHT / CANVAS_WIDTH);
  const scaleX = minimapWidth / CANVAS_WIDTH;
  const scaleY = minimapHeight / CANVAS_HEIGHT;

  return (
    <div className="rounded-xl backdrop-blur-md shadow-lg p-1.5" style={{ background: "var(--panel-bg)", borderWidth: 1, borderColor: "var(--panel-border)" }}>
      <div className="relative overflow-hidden rounded-lg" style={{ width: minimapWidth, height: minimapHeight, background: "var(--minimap-bg)" }}>
        {scene.characters.map((character) => {
          const member = KUMA_TEAM.find((a) => a.id === character.id);
          const team = member?.team;
          const dotColor = team === "dev" ? "#3b82f6" : team === "analytics" ? "#f97316" : team === "strategy" ? "#22c55e" : "#78716c";
          const isActive = character.state === "working" || character.state === "thinking";
          return (
            <div key={character.id} className="absolute" style={{ left: character.position.x * scaleX - 4, top: character.position.y * scaleY - 4 }}>
              <div className={`w-2.5 h-2.5 rounded-full ${isActive ? "animate-pulse" : ""}`} style={{ backgroundColor: dotColor, opacity: isActive ? 1 : 0.7, boxShadow: isActive ? `0 0 4px ${dotColor}` : "none" }} title={`${member?.emoji ?? ""} ${character.name} — ${character.state}`} />
              <span className="absolute left-3 top-[-2px] text-[5px] font-medium whitespace-nowrap pointer-events-none" style={{ color: "var(--t-secondary)" }}>{member?.emoji ?? ""}{member?.nameKo?.[0] ?? character.name[0]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
