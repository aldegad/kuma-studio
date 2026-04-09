import { useState } from "react";
import { useTeamStatusStore, type ProjectTeamStatus, type TeamMemberStatus } from "../../stores/use-team-status-store";
import { useTeamConfigStore } from "../../stores/use-team-config-store";
import type { Agent } from "../../types/agent";
import { teamData } from "../../lib/team-schema";

// ── Engine type detection ────────────────────────────────────────────
type EngineType = "claude" | "codex" | "shell" | "unknown";

const ENGINE_BADGE: Record<EngineType, { label: string; color: string }> = {
  claude:  { label: "CL", color: "#c084fc" },
  codex:   { label: "CX", color: "#34d399" },
  shell:   { label: "SH", color: "#fbbf24" },
  unknown: { label: "??", color: "#64748b" },
};

function getEngineType(agent: Agent | undefined): EngineType {
  if (!agent) return "unknown";
  if (agent.engine === "claude" || agent.engine === "codex") return agent.engine;
  const model = agent.model ?? "";
  if (model.startsWith("claude")) return "claude";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "codex";
  return "unknown";
}

// ── Status styling ───────────────────────────────────────────────────
const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  working:   { dot: "#22d3ee", text: "WRK" },
  thinking:  { dot: "#a78bfa", text: "THK" },
  idle:      { dot: "#475569", text: "IDL" },
  completed: { dot: "#4ade80", text: "DON" },
  error:     { dot: "#f87171", text: "ERR" },
};
const DEFAULT_STYLE = { dot: "#475569", text: "???" };

function getStatusStyle(state: string) {
  return STATUS_STYLE[state] ?? DEFAULT_STYLE;
}

// ── Time formatting ──────────────────────────────────────────────────
function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return "--:--";
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return "now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

// ── Surface row ──────────────────────────────────────────────────────
function SurfaceRow({
  member,
  agent,
}: {
  member: TeamMemberStatus;
  agent: Agent | undefined;
}) {
  const ss = getStatusStyle(member.state);
  const engine = getEngineType(agent);
  const eb = ENGINE_BADGE[engine];
  const isActive = member.state === "working" || member.state === "thinking";
  const surfaceLabel = member.surface ?? "—";

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-[3px] rounded transition-colors group"
      style={{
        background: isActive ? `${ss.dot}08` : "transparent",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--card-bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? `${ss.dot}08` : "transparent"; }}
    >
      {/* Status dot */}
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "animate-pulse" : ""}`}
        style={{
          backgroundColor: ss.dot,
          boxShadow: isActive ? `0 0 6px ${ss.dot}80` : undefined,
        }}
      />

      {/* Surface ID — monospace */}
      <span className="text-[8px] font-mono font-medium shrink-0 w-[52px]"
        style={{ color: isActive ? ss.dot : "var(--t-faint)" }}>
        {surfaceLabel}
      </span>

      {/* Engine badge */}
      <span className="text-[6px] font-mono font-black px-1 py-px rounded shrink-0"
        style={{
          color: eb.color,
          background: eb.color + "15",
          border: `1px solid ${eb.color}20`,
          letterSpacing: "0.05em",
        }}>
        {eb.label}
      </span>

      {/* Name */}
      <span className="text-[9px] truncate flex-1 min-w-0" style={{ color: "var(--t-secondary)" }}>
        {agent?.emoji ?? ""} {agent?.nameKo ?? member.id}
      </span>

      {/* Status code */}
      <span className="text-[7px] font-mono font-bold shrink-0"
        style={{ color: ss.dot }}>
        {ss.text}
      </span>

      {/* Last activity */}
      <span className="text-[7px] font-mono shrink-0 w-[28px] text-right"
        style={{ color: "var(--t-faint)" }}>
        {formatTimeAgo(member.updatedAt)}
      </span>
    </div>
  );
}

// ── Project group ────────────────────────────────────────────────────
function ProjectGroup({
  project,
  agentMap,
  defaultExpanded,
}: {
  project: ProjectTeamStatus;
  agentMap: Map<string, Agent>;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const activeCount = project.members.filter(
    (m) => m.state === "working" || m.state === "thinking",
  ).length;
  const errorCount = project.members.filter((m) => m.state === "error").length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors rounded"
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span className="text-[7px] shrink-0" style={{ color: "var(--t-faint)" }}>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="text-[8px] font-mono font-black uppercase tracking-wider flex-1"
          style={{ color: "var(--t-muted)" }}>
          {project.projectName}
        </span>
        {/* Counters */}
        {activeCount > 0 && (
          <span className="text-[7px] font-mono font-bold px-1 rounded"
            style={{ color: "#22d3ee", background: "rgba(34, 211, 238, 0.1)" }}>
            {activeCount}
          </span>
        )}
        {errorCount > 0 && (
          <span className="text-[7px] font-mono font-bold px-1 rounded"
            style={{ color: "#f87171", background: "rgba(248, 113, 113, 0.1)" }}>
            {errorCount}
          </span>
        )}
        <span className="text-[7px] font-mono" style={{ color: "var(--t-faint)" }}>
          {project.members.length}
        </span>
      </button>

      {expanded && (
        <div className="ml-1 border-l pl-0.5 space-y-px" style={{ borderColor: "var(--border-subtle)" }}>
          {project.members.map((member) => (
            <SurfaceRow
              key={member.id}
              member={member}
              agent={agentMap.get(member.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────
export function CmuxPanel() {
  const projects = useTeamStatusStore((s) => s.projects);
  const allMembers = useTeamConfigStore((s) => s.members);
  const [collapsed, setCollapsed] = useState(true);

  const agentMap = new Map(allMembers.map((a) => [a.id, a] as const));

  // Surface counts
  const totalSurfaces = projects.reduce((sum, p) => sum + p.members.length, 0);
  const activeSurfaces = projects.reduce(
    (sum, p) => sum + p.members.filter((m) => m.state === "working" || m.state === "thinking").length,
    0,
  );

  // Engine type counts from team.json
  const engineCounts = { claude: 0, codex: 0, shell: 0, unknown: 0 };
  for (const member of teamData.members) {
    const e = member.engine === "claude" ? "claude" : member.engine === "codex" ? "codex" : "unknown";
    engineCounts[e]++;
  }

  return (
    <section
      className="rounded-2xl border shadow-lg backdrop-blur-md overflow-hidden"
      style={{ borderColor: "var(--panel-border)", background: "var(--panel-bg)" }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--t-muted)" }}>
            cmux
          </span>
          <span className="text-[8px] font-mono px-1.5 py-px rounded"
            style={{
              color: activeSurfaces > 0 ? "#22d3ee" : "var(--t-faint)",
              background: activeSurfaces > 0 ? "rgba(34, 211, 238, 0.1)" : "var(--card-bg)",
              border: `1px solid ${activeSurfaces > 0 ? "rgba(34, 211, 238, 0.2)" : "var(--card-border)"}`,
            }}>
            {activeSurfaces}/{totalSurfaces}
          </span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-2 pb-2.5 space-y-1">
          {/* Column header */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 border-b"
            style={{ borderColor: "var(--border-subtle)" }}>
            <span className="w-1.5" />
            <span className="text-[6px] font-mono uppercase tracking-widest w-[52px]"
              style={{ color: "var(--t-faint)" }}>SURFACE</span>
            <span className="text-[6px] font-mono uppercase tracking-widest w-[18px]"
              style={{ color: "var(--t-faint)" }}>ENG</span>
            <span className="text-[6px] font-mono uppercase tracking-widest flex-1"
              style={{ color: "var(--t-faint)" }}>NAME</span>
            <span className="text-[6px] font-mono uppercase tracking-widest"
              style={{ color: "var(--t-faint)" }}>ST</span>
            <span className="text-[6px] font-mono uppercase tracking-widest w-[28px] text-right"
              style={{ color: "var(--t-faint)" }}>AGO</span>
          </div>

          {/* Project groups */}
          {projects.map((project, idx) => (
            <ProjectGroup
              key={project.projectId}
              project={project}
              agentMap={agentMap}
              defaultExpanded={idx === 0 || projects.length <= 2}
            />
          ))}

          {/* Footer: engine summary */}
          <div className="flex items-center justify-center gap-3 pt-1 border-t"
            style={{ borderColor: "var(--border-subtle)" }}>
            {(["claude", "codex"] as const).map((e) => {
              const eb = ENGINE_BADGE[e];
              return (
                <span key={e} className="flex items-center gap-1">
                  <span className="text-[6px] font-mono font-black px-1 rounded"
                    style={{ color: eb.color, background: eb.color + "12" }}>
                    {eb.label}
                  </span>
                  <span className="text-[7px] font-mono" style={{ color: "var(--t-faint)" }}>
                    {engineCounts[e]}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
