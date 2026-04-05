import { useEffect, useMemo, useState } from "react";
import type { Agent, AgentState } from "../../types/agent";
import { useOfficeStore } from "../../stores/use-office-store";
import {
  useTeamStatusStore,
  getTeamGroups,
  type TeamMemberStatus,
} from "../../stores/use-team-status-store";
import { fetchTeamStatus } from "../../lib/api";
import { useWsStore } from "../../stores/use-ws-store";
import { TEAM_COLORS } from "../../lib/constants";
import teamData from "../../../../shared/team.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortModelLabel(model?: string): { label: string; color: string } {
  if (!model) return { label: "", color: "#78716c" };
  if (model.includes("codex")) return { label: "Codex", color: "#10B981" };
  if (model.includes("opus")) return { label: "Opus", color: "#8B5CF6" };
  if (model.includes("sonnet")) return { label: "Sonnet", color: "#F59E0B" };
  if (model.includes("haiku")) return { label: "Haiku", color: "#06B6D4" };
  if (model.includes("o4-mini")) return { label: "o4-mini", color: "#F97316" };
  if (model.includes("gpt")) return { label: "GPT", color: "#10B981" };
  return { label: model.split("-").pop() ?? model, color: "#78716c" };
}

const animalEmojiCode: Record<string, string> = {
  ...Object.fromEntries(
    teamData.members.map((member) => [
      member.animal.en,
      Array.from(member.emoji.replace(/\uFE0F/g, ""))
        .map((char) => char.codePointAt(0)?.toString(16))
        .filter((code): code is string => Boolean(code))
        .join("-"),
    ]),
  ),
};

const ROLE_TAG_MAP: Record<string, { label: string; color: string }> = {
  dev: { label: "개발", color: "#4CAF50" },
  analytics: { label: "분석", color: "#FF8C42" },
  strategy: { label: "전략", color: "#6366F1" },
  management: { label: "총괄", color: "#5C4033" },
};

const STATUS_CONFIG: Record<string, { dot: string; glow: string; label: string }> = {
  idle: { dot: "#9CA3AF", glow: "transparent", label: "대기" },
  working: { dot: "#22C55E", glow: "rgba(34,197,94,0.4)", label: "작업 중" },
  thinking: { dot: "#F59E0B", glow: "rgba(245,158,11,0.3)", label: "생각 중" },
  completed: { dot: "#3B82F6", glow: "rgba(59,130,246,0.3)", label: "완료" },
  error: { dot: "#EF4444", glow: "rgba(239,68,68,0.4)", label: "오류" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProjectTabBar({
  projects,
  activeProjectId,
  onSelect,
}: {
  projects: { projectId: string; projectName: string }[];
  activeProjectId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const tabs = [{ projectId: null as string | null, projectName: "전체" }, ...projects];

  return (
    <div className="team-tab-bar flex items-center gap-1 overflow-x-auto px-5 pt-4 pb-0">
      {tabs.map((tab) => {
        const isActive = tab.projectId === activeProjectId;
        return (
          <button
            key={tab.projectId ?? "__all__"}
            onClick={() => onSelect(tab.projectId)}
            className={`team-tab relative shrink-0 rounded-t-lg px-4 py-2 text-xs font-bold tracking-wide transition-all ${
              isActive
                ? "team-tab--active bg-[var(--color-kuma-cream)] text-stone-900 shadow-sm"
                : "bg-stone-100/60 text-stone-500 hover:bg-stone-100 hover:text-stone-700"
            }`}
          >
            {tab.projectName}
            {isActive && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--color-kuma-orange)]" />
            )}
          </button>
        );
      })}
      <div className="flex-1" />
      <div className="flex items-center gap-2 pb-1 pr-1">
        <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(34,197,94,0.5)]" />
          working
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-stone-300" />
          idle
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_4px_rgba(239,68,68,0.4)]" />
          error
        </span>
      </div>
    </div>
  );
}

function MemberCard({
  agent,
  status,
  characterState,
  characterTask,
}: {
  agent: Agent;
  status: TeamMemberStatus;
  characterState?: AgentState;
  characterTask?: string | null;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  const agentState = characterState ?? status.state;
  const task = characterTask ?? status.task;
  const cfg = STATUS_CONFIG[agentState] ?? STATUS_CONFIG.idle;
  const roleTag = ROLE_TAG_MAP[agent.team] ?? ROLE_TAG_MAP.management;
  const teamColor = TEAM_COLORS[agent.team] ?? "#78716c";
  const emojiCode = animalEmojiCode[agent.animal] ?? "1f43b";
  const modelInfo = shortModelLabel(agent.model);
  const isWorking = agentState === "working";
  const isError = agentState === "error";
  const lastLines = status.lastOutputLines;

  return (
    <div
      className="team-member-card group relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Card body */}
      <div
        className={`relative flex flex-col items-center rounded-xl border px-3 py-4 transition-all duration-200 ${
          isWorking
            ? "team-card--working border-green-300/60 bg-gradient-to-b from-green-50/80 to-white shadow-md"
            : isError
              ? "team-card--error border-red-200/60 bg-gradient-to-b from-red-50/50 to-white shadow-sm"
              : "border-stone-200/80 bg-white/90 shadow-sm hover:border-stone-300 hover:shadow-md"
        }`}
        style={
          isWorking
            ? ({ "--glow-color": cfg.glow } as React.CSSProperties)
            : isError
              ? ({ "--glow-color": cfg.glow } as React.CSSProperties)
              : undefined
        }
      >
        {/* Working shimmer bar */}
        {isWorking && (
          <div className="working-progress-bar absolute top-0 left-0 right-0 rounded-t-xl" />
        )}

        {/* Avatar */}
        <div
          className={`relative mb-2.5 ${
            isWorking ? "animate-typing" : agentState === "thinking" ? "animate-float" : ""
          }`}
        >
          <div
            className={`team-avatar flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-110 ${
              isWorking ? "ring-[3px] ring-green-300/50 shadow-lg" : "shadow-md"
            }`}
            style={{
              background: isWorking
                ? `linear-gradient(135deg, ${teamColor}20, ${teamColor}08)`
                : `linear-gradient(135deg, ${teamColor}12, transparent)`,
              border: `2px solid ${isWorking ? "#86EFAC" : `${teamColor}30`}`,
            }}
          >
            <img
              src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${emojiCode}.svg`}
              alt={agent.animalKo}
              className="h-8 w-8 drop-shadow-sm"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = "none";
                el.parentElement!.innerHTML = `<span class="text-xl font-bold" style="color:${teamColor}">${agent.nameKo[0]}</span>`;
              }}
            />
          </div>

          {/* Status dot — pulsing when working */}
          <div
            className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-white ${
              isWorking ? "team-dot-pulse" : ""
            } ${isError ? "team-dot-error" : ""}`}
            style={{ backgroundColor: cfg.dot }}
          />

          {/* Idle zzz */}
          {agentState === "idle" && <div className="animate-zzz" />}

          {/* Working sparkle */}
          {isWorking && <div className="animate-sparkle" />}
        </div>

        {/* Name */}
        <p className="text-[13px] font-bold leading-tight text-stone-800">
          {agent.nameKo}
        </p>

        {/* Role tag */}
        <span
          className="mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: `${roleTag.color}12`,
            color: roleTag.color,
            border: `1px solid ${roleTag.color}20`,
          }}
        >
          {agent.roleKo?.split(".")[0] ?? roleTag.label}
        </span>

        {/* Model badge */}
        {modelInfo.label && (
          <span
            className="mt-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{
              backgroundColor: `${modelInfo.color}10`,
              color: modelInfo.color,
            }}
          >
            {modelInfo.label}
          </span>
        )}

        {/* Status badge */}
        <div
          className={`mt-2 flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[10px] font-semibold ${
            isWorking ? "team-badge-working" : ""
          }`}
          style={{
            backgroundColor: `${cfg.dot}15`,
            color: cfg.dot,
          }}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${isWorking ? "team-dot-pulse-sm" : ""}`}
            style={{ backgroundColor: cfg.dot }}
          />
          {cfg.label}
        </div>

        {/* Active task */}
        {isWorking && task && (
          <p className="mt-2 w-full rounded-lg bg-green-50 px-2 py-1.5 text-center text-[10px] font-medium leading-tight text-green-800/80">
            {task}
          </p>
        )}
      </div>

      {/* Hover tooltip — last 3 output lines */}
      {showTooltip && lastLines.length > 0 && (
        <div className="team-tooltip tooltip-enter pointer-events-none absolute -top-2 left-1/2 z-50 w-64 -translate-x-1/2 -translate-y-full">
          <div className="rounded-lg border border-stone-200 bg-stone-900 p-3 shadow-xl">
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-stone-400">
              최근 출력
            </p>
            <div className="space-y-0.5">
              {lastLines.slice(-3).map((line, i) => (
                <p
                  key={i}
                  className="truncate font-mono text-[10px] leading-relaxed text-stone-300"
                >
                  <span className="mr-1.5 text-stone-600">{`>`}</span>
                  {line}
                </p>
              ))}
            </div>
          </div>
          {/* Arrow */}
          <div className="flex justify-center">
            <div className="h-2 w-2 -translate-y-0.5 rotate-45 border-r border-b border-stone-200 bg-stone-900" />
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSection({
  teamId,
  label,
  emoji,
  members,
  characterMap,
}: {
  teamId: string;
  label: string;
  emoji: string;
  members: (Agent & { status: TeamMemberStatus })[];
  characterMap: Map<string, { state?: AgentState; task?: string | null }>;
}) {
  const teamColor = TEAM_COLORS[teamId] ?? "#78716c";
  const workingCount = members.filter((m) => {
    const char = characterMap.get(m.id);
    return (char?.state ?? m.status.state) === "working";
  }).length;

  return (
    <div className="team-section">
      {/* Section header */}
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-md text-sm"
          style={{
            backgroundColor: `${teamColor}15`,
            border: `1px solid ${teamColor}25`,
          }}
        >
          {emoji || label[0]}
        </div>
        <span
          className="text-xs font-extrabold uppercase tracking-[0.15em]"
          style={{ color: teamColor }}
        >
          {label}
        </span>
        <span className="text-[10px] text-stone-400">
          {members.length}명
        </span>
        {workingCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-600">
            <span className="team-dot-pulse-sm inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
            {workingCount} active
          </span>
        )}
        <div className="flex-1 border-t border-dashed border-stone-200/80" />
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {members.map((member) => {
          const character = characterMap.get(member.id);
          return (
            <MemberCard
              key={member.id}
              agent={member}
              status={member.status}
              characterState={character?.state}
              characterTask={character?.task}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TeamMemberGrid() {
  const characters = useOfficeStore((s) => s.scene.characters);
  const ws = useWsStore((s) => s.ws);

  const projects = useTeamStatusStore((s) => s.projects);
  const activeProjectId = useTeamStatusStore((s) => s.activeProjectId);
  const memberStatus = useTeamStatusStore((s) => s.memberStatus);
  const setProjects = useTeamStatusStore((s) => s.setProjects);
  const setActiveProject = useTeamStatusStore((s) => s.setActiveProject);
  const updateMemberStatus = useTeamStatusStore((s) => s.updateMemberStatus);
  const batchUpdateMembers = useTeamStatusStore((s) => s.batchUpdateMembers);

  // Build character map for live office state overlay
  const characterMap = useMemo(() => {
    const map = new Map<string, { state?: AgentState; task?: string | null }>();
    for (const c of characters) {
      map.set(c.id, { state: c.state as AgentState | undefined, task: c.task });
      if (c.id === "rumi") map.set("lumi", { state: c.state as AgentState | undefined, task: c.task });
    }
    return map;
  }, [characters]);

  // Fetch team status from API on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchTeamStatus();
        if (!cancelled) setProjects(data.projects);
      } catch {
        // API not available yet — use defaults from team.json
      }
    })();
    return () => { cancelled = true; };
  }, [setProjects]);

  // WebSocket: listen for kuma-studio:team-status-update
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);

        // Full snapshot update
        if (data.type === "kuma-studio:team-status-update") {
          if (data.snapshot && Array.isArray(data.snapshot.projects)) {
            setProjects(data.snapshot.projects);
          }
          // Individual member update
          if (data.member) {
            updateMemberStatus(data.member as TeamMemberStatus);
          }
          // Batch member updates
          if (Array.isArray(data.members)) {
            batchUpdateMembers(data.members as TeamMemberStatus[]);
          }
        }
      } catch {
        // ignore non-JSON
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws, setProjects, updateMemberStatus, batchUpdateMembers]);

  // Derive team groups
  const teamGroups = useMemo(
    () => getTeamGroups(activeProjectId, projects, memberStatus),
    [activeProjectId, projects, memberStatus],
  );

  // Stats summary
  const totalMembers = teamGroups.reduce((sum, g) => sum + g.members.length, 0);
  const workingMembers = teamGroups.reduce(
    (sum, g) =>
      sum +
      g.members.filter((m) => {
        const char = characterMap.get(m.id);
        return (char?.state ?? m.status.state) === "working";
      }).length,
    0,
  );

  return (
    <div className="team-dashboard rounded-2xl border border-stone-200/80 bg-[var(--color-kuma-cream)] shadow-sm">
      {/* Project tabs */}
      <ProjectTabBar
        projects={projects.map((p) => ({
          projectId: p.projectId,
          projectName: p.projectName,
        }))}
        activeProjectId={activeProjectId}
        onSelect={setActiveProject}
      />

      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-stone-200/60 px-5 py-3">
        <div>
          <h3 className="text-sm font-extrabold tracking-tight text-stone-800">
            쿠마팀 현황
          </h3>
          <p className="mt-0.5 text-[11px] text-stone-400">
            실시간 팀 상태 모니터링
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5">
            <span className="text-[11px] font-medium text-stone-500">총원</span>
            <span className="text-sm font-black text-stone-800">{totalMembers}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5">
            <span className="team-dot-pulse-sm inline-block h-2 w-2 rounded-full bg-green-400" />
            <span className="text-[11px] font-medium text-green-700">가동 중</span>
            <span className="text-sm font-black text-green-800">{workingMembers}</span>
          </div>
        </div>
      </div>

      {/* Team sections */}
      <div className="space-y-6 p-5">
        {teamGroups.map((group) => (
          <TeamSection
            key={group.teamId}
            teamId={group.teamId}
            label={group.label}
            emoji={group.emoji}
            members={group.members}
            characterMap={characterMap}
          />
        ))}

        {teamGroups.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-stone-400">
              선택한 프로젝트에 배정된 팀원이 없습니다
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
