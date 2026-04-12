import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { useTeamConfigStore } from "../../stores/use-team-config-store";
import { getTeamGroups, useTeamStatusStore } from "../../stores/use-team-status-store";
import { formatModelDetail } from "../../lib/constants";
import type { Agent, AgentState, ModelCatalogEntry } from "../../types/agent";

interface SettingsPanelProps {
  isNight: boolean;
  animationsEnabled: boolean;
  onToggleAnimations: () => void;
  particlesEnabled: boolean;
  onToggleParticles: () => void;
  nightShiftEnabled: boolean;
  onToggleNightShift: () => void;
  className?: string;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  idle: {
    label: "idle",
    color: "#94a3b8",
    bg: "rgba(148, 163, 184, 0.12)",
    border: "rgba(148, 163, 184, 0.25)",
  },
  offline: {
    label: "offline",
    color: "#94a3b8",
    bg: "rgba(148, 163, 184, 0.12)",
    border: "rgba(148, 163, 184, 0.25)",
  },
  working: {
    label: "working",
    color: "#22d3ee",
    bg: "rgba(34, 211, 238, 0.12)",
    border: "rgba(34, 211, 238, 0.3)",
  },
  error: {
    label: "error",
    color: "#f87171",
    bg: "rgba(248, 113, 113, 0.12)",
    border: "rgba(248, 113, 113, 0.3)",
  },
};

const TEAM_ACCENTS: Record<string, { border: string; bg: string; text: string }> = {
  system: { border: "rgba(139, 90, 43, 0.35)", bg: "rgba(139, 90, 43, 0.1)", text: "#d4a574" },
  dev: { border: "rgba(59, 130, 246, 0.3)", bg: "rgba(59, 130, 246, 0.08)", text: "#93c5fd" },
  analytics: { border: "rgba(249, 115, 22, 0.3)", bg: "rgba(249, 115, 22, 0.08)", text: "#fdba74" },
  strategy: { border: "rgba(34, 197, 94, 0.3)", bg: "rgba(34, 197, 94, 0.08)", text: "#86efac" },
};

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;

function findMatchingModelOption(
  member: Pick<Agent, "engine" | "model" | "modelCatalogId" | "effort" | "serviceTier">,
  modelCatalog: readonly ModelCatalogEntry[],
): ModelCatalogEntry | null {
  if (member.modelCatalogId) {
    const directMatch = modelCatalog.find((entry) => entry.id === member.modelCatalogId);
    if (directMatch) {
      return directMatch;
    }
  }

  if (!member.model || (member.engine !== "claude" && member.engine !== "codex")) {
    return null;
  }

  return modelCatalog.find(
    (entry) =>
      entry.type === member.engine
      && entry.model === member.model
      && (entry.effort ?? null) === (member.effort ?? null)
      && (entry.serviceTier ?? null) === (member.serviceTier ?? null),
  ) ?? modelCatalog.find(
    (entry) => entry.type === member.engine && entry.model === member.model,
  ) ?? null;
}

function getCurrentModelLabel(member: Pick<Agent, "model" | "effort" | "serviceTier">): string {
  return formatModelDetail(member.model, {
    effort: member.effort,
    speed: member.serviceTier,
  }) ?? member.model ?? "현재 모델";
}

function normalizeStatusTone(state: AgentState) {
  if (state === "working" || state === "thinking") {
    return STATUS_META.working;
  }

  if (state === "error") {
    return STATUS_META.error;
  }

  if (state === "offline") {
    return STATUS_META.offline;
  }

  return STATUS_META.idle;
}

function getTeamAccent(teamId: string) {
  return TEAM_ACCENTS[teamId] ?? {
    border: "rgba(120, 113, 108, 0.25)",
    bg: "rgba(120, 113, 108, 0.08)",
    text: "#d6d3d1",
  };
}

export function SettingsPanel({
  animationsEnabled,
  onToggleAnimations,
  particlesEnabled,
  onToggleParticles,
  nightShiftEnabled,
  onToggleNightShift,
  className = "",
}: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"office" | "team">("office");
  const [popoverPosition, setPopoverPosition] = useState({ top: 48, left: 16 });
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [changingMember, setChangingMember] = useState<string | null>(null);
  const [forceConfirm, setForceConfirm] = useState<{
    memberId: string;
    memberName: string;
    selection: ModelCatalogEntry;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const fetchTeamConfigFromStore = useTeamConfigStore((s) => s.fetch);
  const teamMembers = useTeamConfigStore((s) => s.members);
  const modelCatalog = useTeamConfigStore((s) => s.modelCatalog);
  const teamConfigLoaded = useTeamConfigStore((s) => s.loaded);
  const projects = useTeamStatusStore((s) => s.projects);
  const activeProjectId = useTeamStatusStore((s) => s.activeProjectId);
  const memberStatus = useTeamStatusStore((s) => s.memberStatus);

  const refreshTeamConfig = useCallback(async () => {
    setTeamLoading(true);
    setTeamError(null);
    try {
      await fetchTeamConfigFromStore();
    } catch {
      setTeamError("팀 설정을 불러올 수 없습니다.");
    } finally {
      setTeamLoading(false);
    }
  }, [fetchTeamConfigFromStore]);

  useEffect(() => {
    if (!open || tab !== "team" || (teamConfigLoaded && teamMembers.length > 0)) {
      return;
    }

    void refreshTeamConfig();
  }, [open, tab, teamConfigLoaded, teamMembers.length, refreshTeamConfig]);

  const teamGroups = useMemo(
    () => getTeamGroups(activeProjectId, projects, memberStatus),
    [activeProjectId, projects, memberStatus, teamMembers],
  );

  const activeProjectName = useMemo(
    () => projects.find((project) => project.projectId === activeProjectId)?.projectName ?? "전체 팀",
    [activeProjectId, projects],
  );

  const visibleMembers = teamGroups.flatMap((group) => group.members);
  const workingCount = visibleMembers.filter(
    (member) => member.status.state === "working" || member.status.state === "thinking",
  ).length;

  const changeModel = useCallback(async (
    memberId: string,
    memberName: string,
    selection: ModelCatalogEntry,
    force = false,
  ) => {
    setChangingMember(memberId);
    setTeamError(null);

    try {
      const res = await fetch(`${BASE_URL}/studio/team-config/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selection.type,
          model: selection.model,
          modelCatalogId: selection.id,
          force,
        }),
      });
      const payload = await res.json().catch(() => null);

      if (res.status === 409) {
        setForceConfirm({ memberId, memberName, selection });
        return;
      }

      if (!res.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : String(res.status));
      }

      await refreshTeamConfig();
    } catch {
      setTeamError(`${memberName} 모델 변경 실패`);
    } finally {
      setChangingMember(null);
    }
  }, [refreshTeamConfig]);

  const syncPopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const width = 320;
    const margin = 16;
    const nextLeft = Math.min(
      Math.max(margin, rect.right - width),
      window.innerWidth - width - margin,
    );

    setPopoverPosition({
      top: rect.bottom + 8,
      left: nextLeft,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    syncPopoverPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const handleViewportChange = () => {
      syncPopoverPosition();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, syncPopoverPosition]);

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shadow-md transition-colors backdrop-blur-md border"
        style={{ background: "var(--panel-bg)", borderColor: "var(--panel-border)", color: "var(--t-muted)" }}
        title="설정"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[70] w-80 rounded-2xl backdrop-blur-md border shadow-xl animate-fade-in"
          style={{
            top: popoverPosition.top,
            left: popoverPosition.left,
            background: "var(--panel-bg-strong)",
            borderColor: "var(--panel-border)",
          }}
        >
          <div className="flex border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <button
              type="button"
              onClick={() => setTab("office")}
              className="flex-1 px-3 py-2 text-[10px] font-bold tracking-wide transition-colors relative"
              style={{ color: tab === "office" ? "var(--t-primary)" : "var(--t-faint)" }}
            >
              오피스
              {tab === "office" && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full" style={{ background: "var(--color-kuma-orange)" }} />}
            </button>
            <button
              type="button"
              onClick={() => setTab("team")}
              className="flex-1 px-3 py-2 text-[10px] font-bold tracking-wide transition-colors relative"
              style={{ color: tab === "team" ? "var(--t-primary)" : "var(--t-faint)" }}
            >
              팀 운영
              {tab === "team" && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full" style={{ background: "var(--color-kuma-orange)" }} />}
            </button>
          </div>

          <div className="p-3">
            {tab === "office" && (
              <div className="space-y-2.5">
                <ToggleRow label="애니메이션" enabled={animationsEnabled} onToggle={onToggleAnimations} />
                <ToggleRow label="파티클 효과" enabled={particlesEnabled} onToggle={onToggleParticles} />
                <div className="border-t pt-2.5" style={{ borderColor: "var(--border-subtle)" }}>
                  <NightShiftToggle enabled={nightShiftEnabled} onToggle={onToggleNightShift} />
                </div>
              </div>
            )}

            {tab === "team" && (
              <div className="space-y-2">
                <div
                  className="rounded-xl border px-3 py-2"
                  style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold" style={{ color: "var(--t-primary)" }}>
                        {activeProjectName}
                      </p>
                      <p className="text-[8px]" style={{ color: "var(--t-faint)" }}>
                        상태와 모델 변경을 한 곳에서 관리합니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshTeamConfig()}
                      className="rounded-md border px-2 py-1 text-[8px] font-semibold transition-colors"
                      style={{ borderColor: "var(--card-border)", color: "var(--t-secondary)" }}
                    >
                      새로고침
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <SummaryChip label={`${visibleMembers.length}명`} tone="neutral" />
                    <SummaryChip label={`${workingCount} working`} tone="working" />
                  </div>
                </div>

                {teamError && (
                  <p className="text-[9px] px-1" style={{ color: "var(--danger-text)" }}>
                    {teamError}
                  </p>
                )}

                {teamLoading && teamGroups.length === 0 ? (
                  <p className="text-[10px] text-center py-3" style={{ color: "var(--t-faint)" }}>
                    불러오는 중...
                  </p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
                    {teamGroups.map((group) => {
                      const accent = getTeamAccent(group.teamId);

                      return (
                        <section
                          key={group.teamId}
                          className="rounded-xl border p-2"
                          style={{ borderColor: accent.border, background: accent.bg }}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2 px-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm leading-none">{group.emoji || "🧩"}</span>
                              <span
                                className="truncate text-[9px] font-black uppercase tracking-[0.14em]"
                                style={{ color: accent.text }}
                              >
                                {group.label}
                              </span>
                            </div>
                            <span className="text-[8px]" style={{ color: "var(--t-faint)" }}>
                              {group.members.length}명
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {group.members.map((member) => {
                              const statusTone = normalizeStatusTone(member.status.state);
                              const selectedOption = findMatchingModelOption(member, modelCatalog);
                              const selectValue = selectedOption?.id ?? member.modelCatalogId ?? member.model ?? "";

                              return (
                                <div
                                  key={member.id}
                                  className="rounded-lg border px-2.5 py-2"
                                  style={{ borderColor: "var(--card-border)", background: "var(--panel-bg)" }}
                                >
                                  <div className="flex items-start gap-2">
                                    <span className="text-base leading-none shrink-0">{member.emoji ?? "👤"}</span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-[10px] font-bold truncate" style={{ color: "var(--t-primary)" }}>
                                          {member.nameKo}
                                        </span>
                                        <span
                                          className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide"
                                          style={{
                                            color: statusTone.color,
                                            background: statusTone.bg,
                                            borderColor: statusTone.border,
                                          }}
                                        >
                                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusTone.color }} />
                                          {statusTone.label}
                                        </span>
                                      </div>
                                      <p className="text-[8px] leading-tight" style={{ color: "var(--t-faint)" }}>
                                        {member.roleKo}
                                      </p>
                                      <p className="text-[7px] font-mono mt-1" style={{ color: "var(--t-faint)" }}>
                                        {member.status.surface ?? "surface 미등록"}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="mt-2">
                                    <select
                                      className="w-full text-[9px] rounded-md border px-2 py-1.5 outline-none cursor-pointer"
                                      style={{
                                        background: "var(--input-bg)",
                                        borderColor: "var(--input-border)",
                                        color: "var(--t-secondary)",
                                      }}
                                      value={selectValue}
                                      disabled={changingMember === member.id}
                                      onChange={(event) => {
                                        const next = modelCatalog.find((option) => option.id === event.target.value);
                                        if (next) {
                                          void changeModel(member.id, member.nameKo, next);
                                        }
                                      }}
                                    >
                                      {modelCatalog.map((option) => (
                                        <option key={option.id} value={option.id}>
                                          {option.label}
                                        </option>
                                      ))}
                                      {!selectedOption && selectValue && (
                                        <option value={selectValue}>{getCurrentModelLabel(member)}</option>
                                      )}
                                    </select>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}

                    {teamGroups.length === 0 && !teamLoading && (
                      <div
                        className="rounded-lg border px-3 py-4 text-center text-[9px]"
                        style={{ borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-faint)" }}
                      >
                        표시할 팀원이 없습니다.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        isOpen={forceConfirm !== null}
        title="작업 중 전환"
        message={`${forceConfirm?.memberName ?? ""}이(가) 현재 작업 중입니다. 강제 전환하시겠습니까?`}
        confirmLabel="강제 전환"
        cancelLabel="취소"
        danger
        onConfirm={() => {
          if (forceConfirm) {
            void changeModel(
              forceConfirm.memberId,
              forceConfirm.memberName,
              forceConfirm.selection,
              true,
            );
          }
          setForceConfirm(null);
        }}
        onCancel={() => setForceConfirm(null)}
      />
    </div>
  );
}

function SummaryChip({ label, tone }: { label: string; tone: "neutral" | "working" }) {
  const style = tone === "working"
    ? {
        color: "#22d3ee",
        background: "rgba(34, 211, 238, 0.12)",
        borderColor: "rgba(34, 211, 238, 0.25)",
      }
    : {
        color: "var(--t-secondary)",
        background: "var(--panel-hover)",
        borderColor: "var(--card-border)",
      };

  return (
    <span
      className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-semibold"
      style={style}
    >
      {label}
    </span>
  );
}

function ToggleRow({ label, enabled, onToggle }: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: "var(--t-secondary)" }}>{label}</span>
      <button
        onClick={onToggle}
        className="w-9 h-5 rounded-full transition-colors relative"
        style={{ background: enabled ? "var(--color-kuma-orange)" : "var(--card-border)" }}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          enabled ? "left-[18px]" : "left-0.5"
        }`} />
      </button>
    </div>
  );
}

function NightShiftToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px]">{enabled ? "🌙" : "☀️"}</span>
        <div>
          <span className="text-[11px] font-semibold" style={{ color: enabled ? "#f59e0b" : "var(--t-secondary)" }}>
            야근 모드
          </span>
          <span className="block text-[8px]" style={{ color: "var(--t-faint)" }}>
            Night Shift
          </span>
        </div>
      </div>
      <button
        onClick={onToggle}
        className="w-10 h-5.5 rounded-full transition-all duration-300 relative"
        style={{
          width: 40,
          height: 22,
          background: enabled
            ? "linear-gradient(135deg, #f59e0b, #d97706)"
            : "var(--card-border)",
          boxShadow: enabled ? "0 0 12px rgba(245, 158, 11, 0.4), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
        }}
      >
        <div
          className="absolute rounded-full shadow-md transition-all duration-300"
          style={{
            top: 2,
            width: 18,
            height: 18,
            left: enabled ? 19 : 2,
            background: enabled
              ? "linear-gradient(135deg, #fffbeb, #fef3c7)"
              : "#e5e7eb",
            boxShadow: enabled ? "0 0 6px rgba(245, 158, 11, 0.3)" : "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}
