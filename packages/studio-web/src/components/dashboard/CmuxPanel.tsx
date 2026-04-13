import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchTeamMemberPrompt } from "../../lib/api";
import { useTeamStatusStore, type ProjectTeamStatus, type TeamMemberStatus } from "../../stores/use-team-status-store";
import { useTeamConfigStore } from "../../stores/use-team-config-store";
import type { Agent, TeamPromptResponse } from "../../types/agent";
import { teamData } from "../../lib/team-schema";

type EngineType = "claude" | "codex" | "shell" | "unknown";

const ENGINE_BADGE: Record<EngineType, { label: string; color: string }> = {
  claude: { label: "CL", color: "#c084fc" },
  codex: { label: "CX", color: "#34d399" },
  shell: { label: "SH", color: "#fbbf24" },
  unknown: { label: "??", color: "#64748b" },
};

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  working: { dot: "#22d3ee", text: "WRK" },
  thinking: { dot: "#a78bfa", text: "THK" },
  idle: { dot: "#475569", text: "IDL" },
  completed: { dot: "#4ade80", text: "DON" },
  error: { dot: "#f87171", text: "ERR" },
};
const DEFAULT_STYLE = { dot: "#475569", text: "???" };
const FOCUSABLE_SELECTOR = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

function getEngineType(agent: Agent | undefined): EngineType {
  if (!agent) return "unknown";
  if (agent.engine === "claude" || agent.engine === "codex") return agent.engine;
  const model = agent.model ?? "";
  if (model.startsWith("claude")) return "claude";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "codex";
  return "unknown";
}

function getStatusStyle(state: string) {
  return STATUS_STYLE[state] ?? DEFAULT_STYLE;
}

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

function PromptViewerModal({
  member,
  agent,
  promptData,
  loading,
  error,
  copied,
  onCopy,
  onRetry,
  onClose,
}: {
  member: TeamMemberStatus;
  agent: Agent | undefined;
  promptData: TeamPromptResponse | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const ss = getStatusStyle(member.state);
  const engine = getEngineType(agent);
  const eb = ENGINE_BADGE[engine];

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "c" && promptData?.prompt) {
        event.preventDefault();
        onCopy();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = modalRef.current
        ? Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
          )
        : [];
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, onCopy, promptData?.prompt]);

  if (typeof document === "undefined") {
    return null;
  }

  const prompt = promptData?.prompt ?? "";
  const lineCount = prompt ? prompt.split(/\r?\n/u).length : 0;
  const roleLabel = agent?.roleKo ?? promptData?.role ?? "역할 정보 없음";
  const builderLabel = promptData?.builder ? `source: ${promptData.builder}` : "source: loading";

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-prompt-title"
        className="flex w-[min(720px,90vw)] max-h-[80vh] flex-col overflow-hidden rounded-2xl border shadow-lg"
        style={{
          borderColor: "var(--panel-border)",
          background: "var(--panel-bg)",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 border-b px-4 py-3"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--panel-bg)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg">{agent?.emoji ?? ""}</span>
                <h2 id="team-prompt-title" className="truncate text-base font-semibold" style={{ color: "var(--t-primary)" }}>
                  {agent?.nameKo ?? member.id}
                </h2>
              </div>
              <p className="mt-1 truncate text-xs" style={{ color: "var(--t-muted)" }}>
                {roleLabel}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded px-1.5 py-px text-[10px] font-mono" style={{ color: "var(--t-faint)", background: "var(--card-bg)" }}>
                {member.surface ?? "—"}
              </span>
              <span
                className="rounded border px-1.5 py-px text-[10px] font-mono font-black"
                style={{
                  color: eb.color,
                  background: `${eb.color}15`,
                  borderColor: `${eb.color}25`,
                }}
              >
                {eb.label}
              </span>
              <span className="text-[10px] font-mono font-bold" style={{ color: ss.dot }}>
                {ss.text}
              </span>
              <button
                type="button"
                onClick={onCopy}
                className="rounded border px-2 py-1 text-[11px] font-medium transition-colors"
                style={{ borderColor: "var(--card-border)", color: "var(--t-secondary)", background: "var(--card-bg)" }}
              >
                {copied ? "복사됨 \u2713" : "복사"}
              </button>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded border px-2 py-1 text-[11px] font-medium transition-colors"
                style={{ borderColor: "var(--card-border)", color: "var(--t-secondary)", background: "var(--card-bg)" }}
                aria-label="시스템 프롬프트 뷰어 닫기"
              >
                \u2715
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              시스템 프롬프트를 불러오는 중이야...
            </p>
          )}

          {!loading && error && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "var(--t-muted)" }}>
                불러오지 못했어. 잠시 후 다시 시도해줘.
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded border px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: "var(--card-border)", color: "var(--t-secondary)", background: "var(--card-bg)" }}
              >
                재시도
              </button>
            </div>
          )}

          {!loading && !error && !prompt && (
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              아직 시스템 프롬프트가 등록되지 않았어.
            </p>
          )}

          {!loading && !error && prompt && (
            <pre
              className="font-mono text-[12px] leading-[1.55] whitespace-pre-wrap break-words"
              style={{ color: "var(--t-secondary)" }}
            >
              {prompt}
            </pre>
          )}
        </div>

        <div
          className="border-t px-4 py-2 text-[10px] font-mono"
          style={{ borderColor: "var(--border-subtle)", color: "var(--t-faint)" }}
        >
          {builderLabel} · {promptData?.project ?? "—"} · {prompt.length.toLocaleString()} chars · {lineCount} lines
          <span className="sr-only" aria-live="polite">{copied ? "시스템 프롬프트를 복사했어." : ""}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SurfaceRow({
  member,
  agent,
  projectId,
  onOpenPrompt,
}: {
  member: TeamMemberStatus;
  agent: Agent | undefined;
  projectId: string;
  onOpenPrompt: (member: TeamMemberStatus, agent: Agent | undefined, projectId: string) => void;
}) {
  const ss = getStatusStyle(member.state);
  const engine = getEngineType(agent);
  const eb = ENGINE_BADGE[engine];
  const isActive = member.state === "working" || member.state === "thinking";
  const surfaceLabel = member.surface ?? "—";
  const [rowHovered, setRowHovered] = useState(false);

  return (
    <div
      className="group flex items-center gap-1.5 rounded px-2 py-[3px] transition-colors"
      style={{
        background: isActive ? `${ss.dot}08` : "transparent",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--card-bg-hover)";
        setRowHovered(true);
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = isActive ? `${ss.dot}08` : "transparent";
        setRowHovered(false);
      }}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "animate-pulse" : ""}`}
        style={{
          backgroundColor: ss.dot,
          boxShadow: isActive ? `0 0 6px ${ss.dot}80` : undefined,
        }}
      />

      <span className="w-[52px] shrink-0 text-[8px] font-mono font-medium" style={{ color: isActive ? ss.dot : "var(--t-faint)" }}>
        {surfaceLabel}
      </span>

      <span
        className="shrink-0 rounded px-1 py-px text-[6px] font-mono font-black"
        style={{
          color: eb.color,
          background: `${eb.color}15`,
          border: `1px solid ${eb.color}20`,
          letterSpacing: "0.05em",
        }}
      >
        {eb.label}
      </span>

      <span className="min-w-0 flex-1 truncate text-[9px]" style={{ color: "var(--t-secondary)" }}>
        {agent?.emoji ?? ""} {agent?.nameKo ?? member.id}
      </span>

      <span className="shrink-0 text-[7px] font-mono font-bold" style={{ color: ss.dot }}>
        {ss.text}
      </span>

      <span className="w-[28px] shrink-0 text-right text-[7px] font-mono" style={{ color: "var(--t-faint)" }}>
        {formatTimeAgo(member.updatedAt)}
      </span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPrompt(member, agent, projectId);
        }}
        className="w-5 shrink-0 text-center text-xs leading-none transition-opacity focus:opacity-100"
        style={{
          color: rowHovered ? "var(--t-primary)" : "var(--t-secondary)",
          opacity: rowHovered ? 1 : 0.45,
        }}
        title="시스템 프롬프트 보기"
        aria-label={`${agent?.nameKo ?? member.id} 시스템 프롬프트 열기`}
      >
        ◧
      </button>
    </div>
  );
}

function ProjectGroup({
  project,
  agentMap,
  defaultExpanded,
  onOpenPrompt,
}: {
  project: ProjectTeamStatus;
  agentMap: Map<string, Agent>;
  defaultExpanded: boolean;
  onOpenPrompt: (member: TeamMemberStatus, agent: Agent | undefined, projectId: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const activeCount = project.members.filter((member) => member.state === "working" || member.state === "thinking").length;
  const errorCount = project.members.filter((member) => member.state === "error").length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors"
        onMouseEnter={(event) => { event.currentTarget.style.background = "var(--panel-hover)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
      >
        <span className="shrink-0 text-[7px]" style={{ color: "var(--t-faint)" }}>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="flex-1 text-[8px] font-mono font-black uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
          {project.projectName}
        </span>
        {activeCount > 0 && (
          <span className="rounded px-1 text-[7px] font-mono font-bold" style={{ color: "#22d3ee", background: "rgba(34, 211, 238, 0.1)" }}>
            {activeCount}
          </span>
        )}
        {errorCount > 0 && (
          <span className="rounded px-1 text-[7px] font-mono font-bold" style={{ color: "#f87171", background: "rgba(248, 113, 113, 0.1)" }}>
            {errorCount}
          </span>
        )}
        <span className="text-[7px] font-mono" style={{ color: "var(--t-faint)" }}>
          {project.members.length}
        </span>
      </button>

      {expanded && (
        <div className="ml-1 space-y-px border-l pl-0.5" style={{ borderColor: "var(--border-subtle)" }}>
          {project.members.map((member) => (
            <SurfaceRow
              key={member.id}
              member={member}
              agent={agentMap.get(member.id)}
              projectId={project.projectId}
              onOpenPrompt={onOpenPrompt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CmuxPanel() {
  const projects = useTeamStatusStore((state) => state.projects);
  const allMembers = useTeamConfigStore((state) => state.members);
  const [collapsed, setCollapsed] = useState(true);
  const [promptMember, setPromptMember] = useState<{
    member: TeamMemberStatus;
    agent: Agent | undefined;
    projectId: string;
  } | null>(null);
  const [promptData, setPromptData] = useState<TeamPromptResponse | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  const agentMap = new Map(allMembers.map((agent) => [agent.id, agent] as const));
  const totalSurfaces = projects.reduce((sum, project) => sum + project.members.length, 0);
  const activeSurfaces = projects.reduce(
    (sum, project) => sum + project.members.filter((member) => member.state === "working" || member.state === "thinking").length,
    0,
  );

  const engineCounts = { claude: 0, codex: 0, shell: 0, unknown: 0 };
  for (const member of teamData.members) {
    const engine = member.engine === "claude" ? "claude" : member.engine === "codex" ? "codex" : "unknown";
    engineCounts[engine] += 1;
  }

  useEffect(() => () => {
    if (copyResetTimerRef.current != null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const loadPrompt = async (memberId: string, projectId: string) => {
    setPromptLoading(true);
    setPromptError(null);
    try {
      const nextPrompt = await fetchTeamMemberPrompt(memberId, projectId);
      setPromptData(nextPrompt);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setPromptLoading(false);
    }
  };

  const handleOpenPrompt = (member: TeamMemberStatus, agent: Agent | undefined, projectId: string) => {
    setCopied(false);
    setPromptData(null);
    setPromptError(null);
    setPromptMember({ member, agent, projectId });
    void loadPrompt(member.id, projectId);
  };

  const handleClosePrompt = () => {
    setPromptMember(null);
    setPromptData(null);
    setPromptError(null);
    setCopied(false);
  };

  const handleCopyPrompt = () => {
    if (!promptData?.prompt || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    void navigator.clipboard.writeText(promptData.prompt).then(() => {
      setCopied(true);
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyResetTimerRef.current = null;
      }, 1_500);
    });
  };

  return (
    <>
      <section
        className="overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
        style={{ borderColor: "var(--panel-border)", background: "var(--panel-bg)" }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--panel-hover)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
              TEAM
            </span>
            <span
              className="rounded px-1.5 py-px text-[8px] font-mono"
              style={{
                color: activeSurfaces > 0 ? "#22d3ee" : "var(--t-faint)",
                background: activeSurfaces > 0 ? "rgba(34, 211, 238, 0.1)" : "var(--card-bg)",
                border: `1px solid ${activeSurfaces > 0 ? "rgba(34, 211, 238, 0.2)" : "var(--card-border)"}`,
              }}
              title={`${activeSurfaces}/${totalSurfaces} active`}
            >
              {activeSurfaces}/{totalSurfaces}
            </span>
          </div>
          <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>

        {!collapsed && (
          <div className="space-y-1 px-2 pb-2.5">
            <div className="flex items-center gap-1.5 border-b px-2 py-0.5" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="w-1.5" />
              <span className="w-[52px] text-[6px] font-mono uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>
                SURFACE
              </span>
              <span className="w-[18px] text-[6px] font-mono uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>
                ENG
              </span>
              <span className="flex-1 text-[6px] font-mono uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>
                NAME
              </span>
              <span className="text-[6px] font-mono uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>
                ST
              </span>
              <span className="w-[28px] text-right text-[6px] font-mono uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>
                AGO
              </span>
              <span className="w-[18px] text-center text-[6px] font-mono uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>
                SYS
              </span>
            </div>

            {projects.map((project, index) => (
              <ProjectGroup
                key={project.projectId}
                project={project}
                agentMap={agentMap}
                defaultExpanded={index === 0 || projects.length <= 2}
                onOpenPrompt={handleOpenPrompt}
              />
            ))}

            <div className="flex items-center justify-center gap-3 border-t pt-1" style={{ borderColor: "var(--border-subtle)" }}>
              {(["claude", "codex"] as const).map((engine) => {
                const badge = ENGINE_BADGE[engine];
                return (
                  <span key={engine} className="flex items-center gap-1">
                    <span className="rounded px-1 text-[6px] font-mono font-black" style={{ color: badge.color, background: `${badge.color}12` }}>
                      {badge.label}
                    </span>
                    <span className="text-[7px] font-mono" style={{ color: "var(--t-faint)" }}>
                      {engineCounts[engine]}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {promptMember && (
        <PromptViewerModal
          member={promptMember.member}
          agent={promptMember.agent}
          promptData={promptData}
          loading={promptLoading}
          error={promptError}
          copied={copied}
          onCopy={handleCopyPrompt}
          onRetry={() => void loadPrompt(promptMember.member.id, promptMember.projectId)}
          onClose={handleClosePrompt}
        />
      )}
    </>
  );
}
