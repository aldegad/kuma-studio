import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchExplorerRoots, fetchOfficeLayout, fetchStudioUiState, patchStudioUiState } from "../lib/api";
import { useWebSocket } from "../hooks/use-websocket";
import { useDashboardStore } from "../stores/use-dashboard-store";
import { useOfficeStore } from "../stores/use-office-store";
import { useTeamStatusStore } from "../stores/use-team-status-store";
import { useWsStore } from "../stores/use-ws-store";
import { useDispatchVisualStore } from "../stores/use-dispatch-visual-store";
import { HIERARCHY_LINES } from "../lib/office-scene";
import type { AgentState } from "../types/agent";
import { useTeamConfigStore } from "../stores/use-team-config-store";
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
import { CmuxPanel } from "../components/dashboard/CmuxPanel";
import { DraggableDashboard, type DashboardPanelItem } from "../components/dashboard/DraggableDashboard";

import { SettingsPanel } from "../components/office/SettingsPanel";
import { useActivityStore } from "../stores/use-activity-store";
import { FileExplorer } from "../components/ide/FileExplorer";
import { useCanvasInteraction, CANVAS_WIDTH, CANVAS_HEIGHT, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX, clamp } from "../hooks/use-canvas-interaction";
import {
  buildStudioProjectTabs,
  CORE_PROJECT_TAB_ID,
  splitHudProjectTabs,
} from "../lib/project-tabs";
import type { GitActivityWorktree } from "../types/stats";

interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: { id: string; status: string; message?: string | null } }
    | { kind: "agent-state-change"; agentId: string; state: AgentState; task?: string | null };
}

const GIT_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;
const HUD_LEGACY_PINNED_PROJECT_STORAGE_KEY = "kuma-studio-hud-pinned-project";
const PROJECT_SEARCH_PARAM = "project";
const WORKTREE_SEARCH_PARAM = "worktree";
const PROJECT_MENU_EXIT_MS = 160;
const HUD_TOP_BAR_HEIGHT_PX = 48;
const HUD_WORKTREE_STRIP_HEIGHT_PX = 34;

interface ProjectMenuPosition {
  left: number;
  top: number;
}

function readProjectSearchParam() {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get(PROJECT_SEARCH_PARAM)?.trim();
  return value && value.length > 0 ? value : null;
}

function readWorktreeSearchParam() {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get(WORKTREE_SEARCH_PARAM)?.trim();
  return value && value.length > 0 ? value : null;
}

function replaceProjectSearchParam(projectId: string | null, worktreePath: string | null = null) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  if (projectId) {
    url.searchParams.set(PROJECT_SEARCH_PARAM, projectId);
  } else {
    url.searchParams.delete(PROJECT_SEARCH_PARAM);
  }
  if (projectId && worktreePath) {
    url.searchParams.set(WORKTREE_SEARCH_PARAM, worktreePath);
  } else {
    url.searchParams.delete(WORKTREE_SEARCH_PARAM);
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatWorktreeButtonLabel(worktree: GitActivityWorktree) {
  if (worktree.isMain) {
    return worktree.branch ?? "main";
  }

  return worktree.branch ?? worktree.name;
}

export function StudioPage() {
  const { status } = useWebSocket();
  const ws = useWsStore((s) => s.ws);

  // Dashboard store
  const fetchGitActivity = useDashboardStore((s) => s.fetchGitActivity);
  const gitActivity = useDashboardStore((s) => s.gitActivity);

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
  const dispatchBubbles = useDispatchVisualStore((s) => s.bubbles);

  // Team config (fetched from API)
  const teamMembers = useTeamConfigStore((s) => s.members);

  // Canvas interaction
  const containerRef = useRef<HTMLDivElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const projectMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const projectMenuPortalRef = useRef<HTMLDivElement | null>(null);
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
  const [nightShiftEnabled, setNightShiftEnabled] = useState(false);
  const [configuredProjectIds, setConfiguredProjectIds] = useState<string[]>([]);
  const [configuredProjectsLoaded, setConfiguredProjectsLoaded] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectMenuRendered, setProjectMenuRendered] = useState(false);
  const [projectMenuVisible, setProjectMenuVisible] = useState(false);
  const [projectMenuPosition, setProjectMenuPosition] = useState<ProjectMenuPosition | null>(null);
  const [hudPinnedProjectIds, setHudPinnedProjectIds] = useState<string[]>([]);
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(null);
  const [studioUiStateLoaded, setStudioUiStateLoaded] = useState(false);
  const invalidProjectParamRef = useRef<string | null>(null);
  const [themeMode, setThemeMode] = useState<"auto" | "light" | "dark">(() => {
    const stored = localStorage.getItem("kuma-studio-theme-mode");
    return stored === "light" || stored === "dark" ? stored : "auto";
  });

  // Fetch initial nightmode state
  useEffect(() => {
    fetch(`http://${window.location.hostname}:${Number(import.meta.env.VITE_KUMA_PORT) || 4312}/studio/nightmode`)
      .then((r) => r.json())
      .then((data) => { if (data?.enabled) setNightShiftEnabled(true); })
      .catch(() => {});
  }, []);

  // Listen for nightmode WebSocket broadcasts
  useEffect(() => {
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "kuma-studio:nightmode" && typeof data.enabled === "boolean") {
          setNightShiftEnabled(data.enabled);
        }
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws]);

  const toggleNightShift = () => {
    const next = !nightShiftEnabled;
    setNightShiftEnabled(next);
    fetch(`http://${window.location.hostname}:${Number(import.meta.env.VITE_KUMA_PORT) || 4312}/studio/nightmode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => {});
  };

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
    const refresh = async () => { try { await fetchGitActivity(); } catch {} };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, GIT_ACTIVITY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchGitActivity]);

  useEffect(() => {
    let cancelled = false;
    const refreshConfiguredProjects = async () => {
      try {
        const roots = await fetchExplorerRoots();
        if (!cancelled) {
          setConfiguredProjectIds(Object.keys(roots.projectRoots));
          setConfiguredProjectsLoaded(true);
        }
      } catch {
        // Keep the last known registry-backed snapshot until the live roots endpoint recovers.
      }
    };

    void refreshConfiguredProjects();
    const handleWindowFocus = () => {
      void refreshConfiguredProjects();
    };
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const state = await fetchStudioUiState();
        if (cancelled) {
          return;
        }

        const legacyPinnedProjectId = localStorage.getItem(HUD_LEGACY_PINNED_PROJECT_STORAGE_KEY)?.trim() || null;
        const serverPinnedProjectIds = state.hud.pinnedProjectIds;
        const nextPinnedProjectIds =
          legacyPinnedProjectId && !serverPinnedProjectIds.includes(legacyPinnedProjectId)
            ? [...serverPinnedProjectIds, legacyPinnedProjectId]
            : serverPinnedProjectIds;
        if (!sameStringArray(nextPinnedProjectIds, serverPinnedProjectIds)) {
          await patchStudioUiState({ hud: { pinnedProjectIds: nextPinnedProjectIds } });
          if (cancelled) {
            return;
          }
          setHudPinnedProjectIds(nextPinnedProjectIds);
          localStorage.removeItem(HUD_LEGACY_PINNED_PROJECT_STORAGE_KEY);
        } else {
          setHudPinnedProjectIds(serverPinnedProjectIds);
          if (legacyPinnedProjectId) {
            localStorage.removeItem(HUD_LEGACY_PINNED_PROJECT_STORAGE_KEY);
          }
        }
        setExplorerOpen(state.explorer.open);
        setStudioUiStateLoaded(true);
      } catch {
        if (!cancelled) {
          setStudioUiStateLoaded(true);
          pushToast("프로젝트 고정 상태를 서버에서 복원하지 못했습니다.", "error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
          const member = teamMembers.find((m) => m.id === ev.agentId);
          if (member) {
            const stateMsg: Record<string, string> = { working: "작업 시작", thinking: "생각 중", completed: "작업 완료", error: "오류 발생", idle: "대기 상태", offline: "오프라인" };
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
  const autoNight = hour >= 20 || hour < 6;
  const isNight = themeMode === "dark" ? true : themeMode === "light" ? false : autoNight;
  const ambientBg = isNight
    ? "linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #1e1b4b 100%)"
    : hour >= 6 && hour < 10 ? "linear-gradient(135deg, #fef3c7 0%, #fde68a 30%, #fef9ee 100%)"
    : hour >= 10 && hour < 17 ? "linear-gradient(135deg, #fefce8 0%, #fef08a 30%, #fffbeb 100%)"
    : hour >= 17 && hour < 20 ? "linear-gradient(135deg, #fed7aa 0%, #fdba74 30%, #fff7ed 100%)"
    : "linear-gradient(135deg, #fefce8 0%, #fef08a 30%, #fffbeb 100%)";

  const activityCount = useActivityStore((s) => s.events.length);
  const projectTabs = useMemo(
    () => buildStudioProjectTabs(projects, configuredProjectIds),
    [configuredProjectIds, projects],
  );
  const {
    pinnedProjectIds: resolvedHudPinnedProjectIds,
    visibleProjects: hudProjects,
    overflowProjects,
  } = useMemo(
    () => splitHudProjectTabs(projectTabs, hudPinnedProjectIds),
    [hudPinnedProjectIds, projectTabs],
  );
  const projectMenuProjects = useMemo(
    () => projectTabs.filter((project) => project.projectId !== CORE_PROJECT_TAB_ID),
    [projectTabs],
  );

  // "system" project members (e.g. kuma, jjooni) are always visible
  const systemApiMemberIds = projects.find((p) => p.projectId === "system")?.members.map((m) => m.id) ?? [];
  const systemTeamMemberIds = teamMembers.filter((m) => m.team === "system").map((m) => m.id);
  const systemMemberIds = [...new Set([...systemApiMemberIds, ...systemTeamMemberIds])];
  const systemMemberIdSet = new Set(systemMemberIds);
  const activeProjectMemberIds = activeProjectId
    ? [
        ...(projectTabs.find((p) => p.projectId === activeProjectId)?.members.map((m) => m.id) ?? []),
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
        const projectMembers = projectTabs.find((p) => p.projectId === activeProjectId)?.members;
        if (!projectMembers) return true;
        return projectMembers.some((m) => m.id === c.id);
      })
    : scene.characters;

  // Active project name for office header
  const activeProjectName = activeProjectId
    ? projectTabs.find((p) => p.projectId === activeProjectId)?.projectName ?? activeProjectId
    : null;
  const projectWorktreesByProjectId = useMemo(
    () => new Map(Object.entries(gitActivity.projectWorktrees ?? {})),
    [gitActivity.projectWorktrees],
  );
  const projectWorktreeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [projectId, worktrees] of projectWorktreesByProjectId.entries()) {
      counts.set(projectId, worktrees.length);
    }
    return counts;
  }, [projectWorktreesByProjectId]);
  const activeProjectWorktrees = activeProjectId
    ? projectWorktreesByProjectId.get(activeProjectId) ?? []
    : [];
  const activeWorktree = activeWorktreePath
    ? activeProjectWorktrees.find((worktree) => worktree.path === activeWorktreePath) ?? null
    : null;
  const activeWorktreeName = activeWorktree ? formatWorktreeButtonLabel(activeWorktree) : null;
  const showWorktreeStrip = Boolean(activeProjectId && activeProjectWorktrees.length > 1);
  const explorerTopOffset = HUD_TOP_BAR_HEIGHT_PX + (showWorktreeStrip ? HUD_WORKTREE_STRIP_HEIGHT_PX : 0);
  const activeOverflowProject = activeProjectId
    ? overflowProjects.find((project) => project.projectId === activeProjectId) ?? null
    : null;
  const activeOverflowWorktreeCount = activeOverflowProject
    ? projectWorktreeCounts.get(activeOverflowProject.projectId) ?? 0
    : 0;
  const projectMenuLabel = activeOverflowProject?.projectName ?? (overflowProjects.length > 0 ? `프로젝트 ${overflowProjects.length}` : "프로젝트");
  const projectMenuAnchorSignature = [
    projectMenuLabel,
    String(activeOverflowWorktreeCount),
    hudProjects.map((project) => project.projectId).join("|"),
    resolvedHudPinnedProjectIds.join("|"),
    projectMenuProjects.length,
  ].join("::");

  const updateProjectMenuPosition = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const button = projectMenuButtonRef.current;
    if (!button) {
      return;
    }

    const menuWidth = 320;
    const menuEstimatedHeight = 352;
    const viewportMargin = 8;
    const rect = button.getBoundingClientRect();
    const maxLeft = Math.max(viewportMargin, window.innerWidth - menuWidth - viewportMargin);
    const maxTop = Math.max(viewportMargin, window.innerHeight - menuEstimatedHeight - viewportMargin);
    const left = Math.min(Math.max(viewportMargin, rect.left), maxLeft);
    const top = Math.min(Math.max(viewportMargin, rect.bottom + 10), maxTop);
    setProjectMenuPosition((previous) => (
      previous?.left === left && previous.top === top ? previous : { left, top }
    ));
  }, []);

  const persistHudPinnedProjectIds = useCallback((nextProjectIds: string[]) => {
    const previousProjectIds = hudPinnedProjectIds;
    setHudPinnedProjectIds(nextProjectIds);
    void patchStudioUiState({ hud: { pinnedProjectIds: nextProjectIds } }).catch(() => {
      setHudPinnedProjectIds(previousProjectIds);
      pushToast("프로젝트 고정 상태 저장에 실패했습니다.", "error");
    });
  }, [hudPinnedProjectIds]);

  const persistExplorerOpen = useCallback((nextOpen: boolean) => {
    const previousOpen = explorerOpen;
    setExplorerOpen(nextOpen);
    void patchStudioUiState({ explorer: { open: nextOpen } }).catch(() => {
      setExplorerOpen(previousOpen);
      pushToast("탐색기 열림 상태 저장에 실패했습니다.", "error");
    });
  }, [explorerOpen]);

  const selectProject = useCallback((nextProjectId: string | null) => {
    setActiveWorktreePath(null);
    setActiveProject(nextProjectId);
    replaceProjectSearchParam(nextProjectId);
  }, [setActiveProject]);

  const selectWorktree = useCallback((nextWorktreePath: string | null) => {
    setActiveWorktreePath(nextWorktreePath);
    replaceProjectSearchParam(activeProjectId, nextWorktreePath);
  }, [activeProjectId]);

  useEffect(() => {
    if (!configuredProjectsLoaded) {
      return;
    }

    const applyProjectFromUrl = () => {
      const requestedProjectId = readProjectSearchParam();
      if (!requestedProjectId) {
        invalidProjectParamRef.current = null;
        setActiveProject(null);
        setActiveWorktreePath(null);
        return;
      }

      if (projectTabs.some((project) => project.projectId === requestedProjectId)) {
        invalidProjectParamRef.current = null;
        setActiveProject(requestedProjectId);
        const requestedWorktreePath = readWorktreeSearchParam();
        if (!requestedWorktreePath) {
          setActiveWorktreePath(null);
          return;
        }

        if (!gitActivity.lastUpdated) {
          setActiveWorktreePath(requestedWorktreePath);
          return;
        }

        const projectWorktrees = projectWorktreesByProjectId.get(requestedProjectId) ?? [];
        if (projectWorktrees.some((worktree) => worktree.path === requestedWorktreePath)) {
          setActiveWorktreePath(requestedWorktreePath);
          return;
        }

        pushToast(`등록되지 않은 워크트리 URL 파라미터를 제거했습니다: ${requestedProjectId}`, "error");
        replaceProjectSearchParam(requestedProjectId);
        setActiveWorktreePath(null);
        return;
      }

      if (invalidProjectParamRef.current !== requestedProjectId) {
        invalidProjectParamRef.current = requestedProjectId;
        pushToast(`등록되지 않은 프로젝트 URL 파라미터를 제거했습니다: ${requestedProjectId}`, "error");
      }
      replaceProjectSearchParam(null);
      setActiveProject(null);
      setActiveWorktreePath(null);
    };

    applyProjectFromUrl();
    window.addEventListener("popstate", applyProjectFromUrl);
    return () => window.removeEventListener("popstate", applyProjectFromUrl);
  }, [configuredProjectsLoaded, gitActivity.lastUpdated, projectTabs, projectWorktreesByProjectId, setActiveProject]);

  useEffect(() => {
    if (!configuredProjectsLoaded || !studioUiStateLoaded) {
      return;
    }

    if (!sameStringArray(resolvedHudPinnedProjectIds, hudPinnedProjectIds)) {
      persistHudPinnedProjectIds(resolvedHudPinnedProjectIds);
    }
  }, [
    configuredProjectsLoaded,
    hudPinnedProjectIds,
    persistHudPinnedProjectIds,
    resolvedHudPinnedProjectIds,
    studioUiStateLoaded,
  ]);

  useEffect(() => {
    if (!projectMenuOpen) {
      return;
    }

    updateProjectMenuPosition();
    window.addEventListener("resize", updateProjectMenuPosition);
    window.addEventListener("scroll", updateProjectMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateProjectMenuPosition);
      window.removeEventListener("scroll", updateProjectMenuPosition, true);
    };
  }, [projectMenuOpen, updateProjectMenuPosition]);

  useEffect(() => {
    if (projectMenuOpen) {
      setProjectMenuRendered(true);
      updateProjectMenuPosition();
      const frame = window.requestAnimationFrame(() => setProjectMenuVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setProjectMenuVisible(false);
    const timer = window.setTimeout(() => {
      setProjectMenuRendered(false);
      setProjectMenuPosition(null);
    }, PROJECT_MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [projectMenuOpen, updateProjectMenuPosition]);

  useEffect(() => {
    if (!projectMenuOpen) {
      return;
    }

    const frame = window.requestAnimationFrame(updateProjectMenuPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [projectMenuAnchorSignature, projectMenuOpen, updateProjectMenuPosition]);

  useEffect(() => {
    if (!projectMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (projectMenuRef.current?.contains(target) || projectMenuPortalRef.current?.contains(target)) {
        return;
      }
      setProjectMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectMenuOpen]);

  useEffect(() => {
    if (activeProjectId && !projectTabs.some((project) => project.projectId === activeProjectId)) {
      replaceProjectSearchParam(null);
      setActiveProject(null);
      setActiveWorktreePath(null);
    }
  }, [activeProjectId, projectTabs, setActiveProject]);

  useEffect(() => {
    if (!activeProjectId || !activeWorktreePath || !gitActivity.lastUpdated) {
      return;
    }

    const belongsToProject = activeProjectWorktrees.some((worktree) => worktree.path === activeWorktreePath);
    if (belongsToProject) {
      return;
    }

    replaceProjectSearchParam(activeProjectId);
    setActiveWorktreePath(null);
  }, [activeProjectId, activeProjectWorktrees, activeWorktreePath, gitActivity.lastUpdated]);

  const dashboardPanels: DashboardPanelItem[] = [
    { id: "plan-panel", title: "계획 진행률", className: "w-72", content: <PlanPanel activeProjectId={activeProjectId} activeProjectName={activeProjectName} /> },
    { id: "git-log", title: "커밋 로그", className: "w-80", content: <GitLogPanel activeProjectId={activeProjectId} activeProjectName={activeProjectName} activeWorktreePath={activeWorktreePath} activeWorktreeName={activeWorktreeName} /> },
    { id: "memo", title: "메모", className: "w-[min(46rem,calc(100vw-2rem))]", content: <MemoPanel /> },
    { id: "content", title: "스레드 콘텐츠", className: "w-[min(46rem,calc(100vw-2rem))]", content: <ContentPanel activeProjectId={activeProjectId} /> },
    { id: "experiment", title: "실험 파이프라인", className: "w-[min(42rem,calc(100vw-2rem))]", content: <ExperimentPanel /> },
    { id: "cmux", title: "TEAM", className: "w-64", content: <CmuxPanel activeProjectId={activeProjectId} activeProjectName={activeProjectName} /> },
    { id: "activity-feed", title: "활동 로그", className: "w-72", content: <ActivityFeed />, hidden: activityCount === 0 },
    { id: "skills", title: "확장", className: "w-80", content: <SkillsPanel /> },
    { id: "minimap", title: "미니맵", className: "w-[152px]",
      defaultPosition: ({ height }) => ({ x: 16, y: Math.max(height - 308, 72) }),
      content: <Minimap scene={scene} />,
    },
    { id: "whiteboard", title: "작업 보드", className: "w-64", defaultPosition: { x: 290, y: 30 }, content: <Whiteboard /> },
  ];

  const projectMenuPopover =
    projectMenuRendered && projectMenuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={projectMenuPortalRef}
            className="fixed z-[1000] w-80 overflow-hidden rounded-2xl border shadow-[0_22px_48px_-20px_rgba(15,23,42,0.5)] backdrop-blur-xl"
            style={{
              left: projectMenuPosition.left,
              top: projectMenuPosition.top,
              background: isNight ? "rgba(33, 22, 12, 0.92)" : "rgba(79, 54, 28, 0.92)",
              borderColor: "rgba(251, 191, 36, 0.18)",
              filter: projectMenuVisible ? "blur(0)" : "blur(1px)",
              opacity: projectMenuVisible ? 1 : 0,
              pointerEvents: projectMenuVisible ? "auto" : "none",
              transform: projectMenuVisible ? "translate3d(0, 0, 0) scale(1)" : "translate3d(0, -6px, 0) scale(0.985)",
              transformOrigin: "top left",
              transition: `opacity ${PROJECT_MENU_EXIT_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), transform ${PROJECT_MENU_EXIT_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), filter ${PROJECT_MENU_EXIT_MS}ms ease`,
            }}
            role="menu"
          >
            <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(251, 191, 36, 0.12)" }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100/90">프로젝트 선택</p>
                <p className="text-[9px] text-amber-100/55">별표를 누르면 상단 바에 고정됩니다.</p>
              </div>
              <span className="rounded-full border px-2 py-0.5 text-[9px] font-semibold text-amber-100/80" style={{ borderColor: "rgba(251, 191, 36, 0.16)" }}>
                {projectMenuProjects.length}개
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto px-2 py-2">
              {projectMenuProjects.map((project) => {
                const isActive = activeProjectId === project.projectId;
                const isPinned = resolvedHudPinnedProjectIds.includes(project.projectId);
                const isVisibleOnHud = hudProjects.some((entry) => entry.projectId === project.projectId);
                const worktreeCount = projectWorktreeCounts.get(project.projectId) ?? 0;
                return (
                  <div key={project.projectId} className="flex items-center gap-1.5 py-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        selectProject(project.projectId);
                        setProjectMenuOpen(false);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
                        isActive ? "bg-amber-300/14" : "hover:bg-white/6"
                      }`}
                      role="menuitem"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-amber-300" : "bg-amber-100/35"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold text-amber-50">
                          {project.projectName}
                        </span>
                        <span className="block text-[9px] text-amber-100/55">
                          {project.members.length}명
                          {isVisibleOnHud ? " • 상단 노출" : ""}
                          {worktreeCount > 1 ? ` • worktree ${worktreeCount}` : ""}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        persistHudPinnedProjectIds(
                          isPinned
                            ? resolvedHudPinnedProjectIds.filter((projectId) => projectId !== project.projectId)
                            : [...resolvedHudPinnedProjectIds, project.projectId],
                        );
                      }}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-sm transition-colors ${
                        isPinned
                          ? "border-amber-300/35 bg-amber-300/16 text-amber-200"
                          : "border-transparent bg-white/5 text-amber-100/45 hover:border-amber-300/18 hover:text-amber-100"
                      }`}
                      title={isPinned ? "상단 고정 해제" : "상단 고정"}
                      aria-label={isPinned ? `${project.projectName} 상단 고정 해제` : `${project.projectName} 상단 고정`}
                    >
                      {isPinned ? "★" : "☆"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`h-screen w-screen overflow-hidden relative${dragState ? " select-none" : ""}`} data-theme={isNight ? "night" : "day"} style={{ background: ambientBg, transition: "background 60s ease" }}>
      {projectMenuPopover}
      {particlesEnabled && <AmbientParticles isNight={isNight} />}

      {/* Office canvas */}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden select-none" onMouseDown={(e) => { window.getSelection()?.removeAllRanges(); setSelectedCharId(null); handleCanvasMouseDown(e); }} style={{ cursor: dragState?.kind === "pan" ? "grabbing" : "grab" }}>
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

          {/* Hierarchy lines — use actual character positions so lines follow movement */}
          <svg className="absolute inset-0 pointer-events-none" width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
            {HIERARCHY_LINES.map(({ from, to, color }) => {
              const fromChar = visibleCharacters.find((c) => c.id === from);
              const toChar = visibleCharacters.find((c) => c.id === to);
              if (!fromChar || !toChar) return null;
              const fromPos = fromChar.position;
              const toPos = toChar.position;
              const midY = (fromPos.y + toPos.y) / 2;
              const isActive = fromChar.state === "working" || fromChar.state === "thinking" || toChar.state === "working" || toChar.state === "thinking";
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

          {visibleCharacters.map((character) => {
            const status = memberStatus.get(character.id);
            const isActive = character.state === "working" || character.state === "thinking";
            const dispatchBubbleLines = dispatchBubbles[character.id];
            const speechLines = dispatchBubbleLines ?? (
              isActive && status?.lastOutputLines && status.lastOutputLines.length > 0
                ? status.lastOutputLines
                : undefined
            );
            return (
            <Character key={character.id} character={character} isDragging={dragState?.kind === "character" && dragState.id === character.id} isSelected={selectedCharId === character.id}
              speechBubbleLines={speechLines}
              onClick={(event) => { event.stopPropagation(); setSelectedCharId((prev) => prev === character.id ? null : character.id); }}
              onDoubleClick={(event) => { event.stopPropagation(); const container = containerRef.current; if (!container) return; const focusZoom = 1.2; setZoom((_z) => focusZoom); /* setPanX/Y handled by zoom setter would need direct — simplified via inline */ }}
              onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); setDragState({ kind: "character", id: character.id, offsetX: (event.clientX - r.left) / zoom - event.currentTarget.offsetWidth / 2, offsetY: (event.clientY - r.top) / zoom - event.currentTarget.offsetHeight / 2 }); }} />
            );
          })}
        </div>
      </div>

      {/* Top bar — Game HUD */}
      <div className="game-hud-bar absolute top-0 left-0 right-0 z-[30] flex items-center justify-between px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-lg font-black tracking-tight text-amber-200" style={{ textShadow: "0 0 12px rgba(255, 200, 100, 0.4), 0 1px 3px rgba(0,0,0,0.4)" }}>쿠마 스튜디오</span>
          <span className="rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-semibold px-2 py-0.5 border border-amber-400/25">{visibleCharacters.length}명</span>

          {/* Project tabs — zone selector */}
          {projectTabs.length > 0 && (
            <div ref={projectMenuRef} className="relative ml-2 flex min-w-0 max-w-[min(56vw,52rem)] items-center gap-1">
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto pr-1">
                <button type="button" onClick={() => selectProject(null)}
                  className={`rounded px-2.5 py-0.5 text-[10px] font-semibold transition-colors border ${
                    activeProjectId === null
                      ? isNight
                        ? "bg-amber-400/28 text-amber-50 border-amber-300/45"
                        : "bg-amber-500/30 text-amber-100 border-amber-400/40"
                      : isNight
                        ? "bg-white/8 text-amber-100/80 border-amber-300/18 hover:bg-white/14 hover:text-amber-50"
                        : "bg-white/5 text-amber-300/60 border-transparent hover:bg-white/10 hover:text-amber-200"
                  }`}>
                  전체
                </button>
                {hudProjects.map((p) => {
                  const worktreeCount = projectWorktreeCounts.get(p.projectId) ?? 0;
                  return (
                    <button key={p.projectId} type="button" onClick={() => selectProject(p.projectId)}
                      className={`flex items-center gap-1 rounded px-2.5 py-0.5 text-[10px] font-semibold transition-colors border ${
                        activeProjectId === p.projectId
                          ? isNight
                            ? "bg-amber-400/28 text-amber-50 border-amber-300/45"
                            : "bg-amber-500/30 text-amber-100 border-amber-400/40"
                          : isNight
                            ? "bg-white/8 text-amber-100/80 border-amber-300/18 hover:bg-white/14 hover:text-amber-50"
                            : "bg-white/5 text-amber-300/60 border-transparent hover:bg-white/10 hover:text-amber-200"
                      }`}>
                      <span className="truncate max-w-[9rem]">{p.projectName}</span>
                      {worktreeCount > 1 && (
                        <span className="rounded-full border border-amber-200/20 px-1 text-[8px] leading-3 text-amber-100/65">
                          wt {worktreeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {projectMenuProjects.length > 0 && (
                <>
                  <button
                    type="button"
                    ref={projectMenuButtonRef}
                    onClick={() => {
                      const nextOpen = !projectMenuOpen;
                      setProjectMenuOpen(nextOpen);
                      if (nextOpen) {
                        window.requestAnimationFrame(updateProjectMenuPosition);
                      }
                    }}
                    className={`flex items-center gap-1 rounded px-2.5 py-0.5 text-[10px] font-semibold transition-colors border ${
                      activeOverflowProject || projectMenuOpen
                        ? isNight
                          ? "bg-amber-400/24 text-amber-50 border-amber-300/35"
                          : "bg-amber-500/24 text-amber-100 border-amber-400/30"
                        : isNight
                          ? "bg-white/8 text-amber-100/80 border-amber-300/18 hover:bg-white/14 hover:text-amber-50"
                          : "bg-white/5 text-amber-300/60 border-transparent hover:bg-white/10 hover:text-amber-200"
                    }`}
                    title="프로젝트 선택"
                    aria-haspopup="menu"
                    aria-expanded={projectMenuOpen}
                  >
                    <span className="truncate max-w-[9rem]">{projectMenuLabel}</span>
                    {activeOverflowWorktreeCount > 1 && (
                      <span className="rounded-full border border-amber-200/20 px-1 text-[8px] leading-3 text-amber-100/65">
                        wt {activeOverflowWorktreeCount}
                      </span>
                    )}
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 16 16"
                      className={`transition-transform ${projectMenuOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3.5 6l4.5 4 4.5-4" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          )}

          <span className={`rounded px-2 py-0.5 text-[10px] font-medium border ${isNight ? "bg-white/10 text-amber-100/90 border-amber-200/15" : "bg-white/8 text-amber-200/80 border-white/10"}`}>
            {isNight ? "🌙" : hour < 12 ? "☀️" : "🌤️"} {String(hour).padStart(2, "0")}:{String(new Date().getMinutes()).padStart(2, "0")}
          </span>
          {/* Theme mode toggle: auto / light / dark */}
          <div className={`flex items-center rounded border overflow-hidden ${isNight ? "border-amber-200/15 bg-white/6" : "border-white/10"}`}>
            {(["auto", "light", "dark"] as const).map((mode) => {
              const isActive = themeMode === mode;
              const icon = mode === "auto" ? "A" : mode === "light" ? "☀" : "☾";
              return (
                <button key={mode} type="button" title={mode === "auto" ? "자동 (시간 기반)" : mode === "light" ? "라이트 모드" : "다크 모드"}
                  onClick={() => { setThemeMode(mode); localStorage.setItem("kuma-studio-theme-mode", mode); }}
                  className={`px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                    isActive
                      ? isNight
                        ? "bg-amber-400/28 text-amber-50"
                        : "bg-amber-500/30 text-amber-100"
                      : isNight
                        ? "bg-white/6 text-amber-100/75 hover:bg-white/12 hover:text-amber-50"
                        : "bg-white/5 text-amber-300/40 hover:bg-white/10 hover:text-amber-200/70"
                  }`}
                >{icon}</button>
              );
            })}
          </div>
          <button type="button" onClick={() => setShowHelp(true)} className={`rounded w-5 h-5 flex items-center justify-center text-[10px] font-bold border transition-colors ${isNight ? "bg-white/10 text-amber-100/85 border-amber-200/15 hover:bg-white/16 hover:text-amber-50" : "bg-white/8 text-amber-200/70 border-white/10 hover:bg-white/15 hover:text-amber-100"}`} title="단축키 도움말 (?)" aria-label="단축키 도움말 열기">?</button>
          <button type="button" onClick={() => persistExplorerOpen(!explorerOpen)} className={`rounded h-5 flex items-center justify-center text-[10px] font-bold px-2 border transition-colors ${
            explorerOpen
              ? isNight
                ? "bg-amber-400/28 text-amber-50 border-amber-300/40"
                : "bg-amber-500/30 text-amber-100 border-amber-400/30"
              : isNight
                ? "bg-white/10 text-amber-100/85 border-amber-200/15 hover:bg-white/16 hover:text-amber-50"
                : "bg-white/8 text-amber-200/70 border-white/10 hover:bg-white/15 hover:text-amber-100"
          }`} title="탐색기 토글 (파일/Vault)" aria-label="탐색기 열기/닫기">{explorerOpen ? "✕ 탐색기" : "📂 탐색기"}</button>
        </div>
        <div className="flex items-center gap-2">
          <SettingsPanel className="shrink-0" isNight={isNight} animationsEnabled={animationsEnabled} onToggleAnimations={() => setAnimationsEnabled((v) => !v)} particlesEnabled={particlesEnabled} onToggleParticles={() => setParticlesEnabled((v) => !v)} nightShiftEnabled={nightShiftEnabled} onToggleNightShift={toggleNightShift} />
          <div className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium border ${status === "connected" ? "bg-green-500/15 text-green-300 border-green-500/25" : status === "connecting" ? "bg-amber-500/15 text-amber-300 border-amber-500/25" : "bg-red-500/15 text-red-300 border-red-500/25"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status === "connected" ? "bg-green-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : "bg-red-400"}`} />
            {status === "connected" ? "연결됨" : status === "connecting" ? "연결 중..." : "연결 끊김"}
          </div>
        </div>
      </div>

      {showWorktreeStrip && (
        <div
          className="absolute left-0 right-0 z-[29] flex items-center gap-2 overflow-hidden border-t border-amber-200/10 px-4 py-1"
          style={{
            top: HUD_TOP_BAR_HEIGHT_PX,
            height: HUD_WORKTREE_STRIP_HEIGHT_PX,
            background: isNight ? "rgba(38, 25, 14, 0.78)" : "rgba(92, 60, 30, 0.72)",
            boxShadow: "0 8px 18px rgba(0,0,0,0.12)",
          }}
        >
          <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-amber-100/55">
            worktree
          </span>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => selectWorktree(null)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
                activeWorktreePath === null
                  ? "border-amber-300/45 bg-amber-300/20 text-amber-50"
                  : "border-amber-200/12 bg-white/5 text-amber-100/60 hover:border-amber-200/24 hover:text-amber-50"
              }`}
            >
              프로젝트 전체
            </button>
            {activeProjectWorktrees.map((worktree) => {
              const isSelected = activeWorktreePath === worktree.path;
              return (
                <button
                  key={worktree.path}
                  type="button"
                  onClick={() => selectWorktree(worktree.path)}
                  title={worktree.path}
                  className={`flex max-w-[13rem] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
                    isSelected
                      ? "border-amber-300/45 bg-amber-300/20 text-amber-50"
                      : "border-amber-200/12 bg-white/5 text-amber-100/60 hover:border-amber-200/24 hover:text-amber-50"
                  }`}
                >
                  <span className="truncate">{formatWorktreeButtonLabel(worktree)}</span>
                  {!worktree.isMain && (
                    <span className="rounded-full bg-amber-100/10 px-1 text-[8px] text-amber-100/55">linked</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* File Explorer */}
      {explorerOpen && (
        <div className="absolute left-0 bottom-0 z-[50]" style={{ top: explorerTopOffset, maxWidth: "min(1720px, 94vw)" }}>
          <FileExplorer
            onCollapse={() => persistExplorerOpen(false)}
            activeProjectId={activeProjectId}
            activeProjectName={activeProjectName}
            activeWorktreePath={activeWorktreePath}
            activeWorktreeName={activeWorktreeName}
          />
        </div>
      )}

      <ToastContainer />
      <DraggableDashboard panels={dashboardPanels} />

      {/* Zoom controls — game style */}
      <div className="game-zoom-bar absolute bottom-4 right-4 z-[35] flex items-center gap-1 rounded-lg px-2 py-1">
        <button type="button" onClick={() => setZoom(clamp(zoom * 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/80 text-sm font-bold" aria-label="줌 인">+</button>
        <span className="text-[10px] text-amber-200/60 font-medium min-w-[32px] text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(clamp(zoom / 1.2, ZOOM_MIN, ZOOM_MAX))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/80 text-sm font-bold" aria-label="줌 아웃">{"\u2212"}</button>
        <button type="button" onClick={() => { setZoom(ZOOM_DEFAULT); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/60 text-xs" title="초기화" aria-label="줌과 위치 초기화">{"\u21BA"}</button>
        <button type="button" onClick={fitToScreen} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 text-amber-200/60 text-xs" title="전체 보기" aria-label="전체 보기">{"\u2B1C"}</button>
      </div>

      {/* Help overlay */}
      {showHelp && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
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

function Minimap({ scene }: { scene: ReturnType<typeof useOfficeStore.getState>["scene"] }) {
  const teamMembers = useTeamConfigStore((s) => s.members);
  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`, background: "var(--minimap-bg)" }}>
      {scene.characters.map((character) => {
        const member = teamMembers.find((a) => a.id === character.id);
        const team = member?.team;
        const dotColor = team === "dev" ? "#3b82f6" : team === "analytics" ? "#f97316" : team === "strategy" ? "#22c55e" : team === "system" ? "#8b5a2b" : "#78716c";
        const isActive = character.state === "working" || character.state === "thinking";
        return (
          <div key={character.id} className="absolute" style={{ left: `${(character.position.x / CANVAS_WIDTH) * 100}%`, top: `${(character.position.y / CANVAS_HEIGHT) * 100}%`, transform: "translate(-4px, -4px)" }}>
            <div className={`w-2.5 h-2.5 rounded-full ${isActive ? "animate-pulse" : ""}`} style={{ backgroundColor: dotColor, opacity: isActive ? 1 : 0.7, boxShadow: isActive ? `0 0 4px ${dotColor}` : "none" }} title={`${member?.emoji ?? ""} ${character.name} — ${character.state}`} />
            <span className="absolute left-3 top-[-2px] text-[5px] font-medium whitespace-nowrap pointer-events-none" style={{ color: "var(--t-secondary)" }}>{member?.emoji ?? ""}{member?.nameKo?.[0] ?? character.name[0]}</span>
          </div>
        );
      })}
    </div>
  );
}
