import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import type { Plan, PlanStatus } from "../../types/plan";
import { PlanDetailModal } from "./PlanDetailModal";

/** Status → color mapping for plan status dots */
const PLAN_STATUS_COLORS: Record<string, { dot: string; glow: string; label: string }> = {
  completed: { dot: "#22c55e", glow: "rgba(34, 197, 94, 0.4)", label: "완료" },
  cancelled: { dot: "#4ade80", glow: "rgba(134, 239, 172, 0.3)", label: "취소" },
  active:    { dot: "#3b82f6", glow: "rgba(59, 130, 246, 0.4)", label: "진행 중" },
  in_progress: { dot: "#3b82f6", glow: "rgba(59, 130, 246, 0.4)", label: "진행 중" },
  hold:      { dot: "#eab308", glow: "rgba(234, 179, 8, 0.4)", label: "보류" },
  blocked:   { dot: "#f97316", glow: "rgba(249, 115, 22, 0.4)", label: "컨펌 대기" },
  failed:    { dot: "#ef4444", glow: "rgba(239, 68, 68, 0.4)", label: "실패" },
  error:     { dot: "#ef4444", glow: "rgba(239, 68, 68, 0.4)", label: "에러" },
  draft:     { dot: "#6b7280", glow: "rgba(107, 114, 128, 0.3)", label: "초안" },
  archived:  { dot: "#6b7280", glow: "rgba(107, 114, 128, 0.2)", label: "보관됨" },
};
const DEFAULT_STATUS_COLOR = { dot: "#6b7280", glow: "rgba(107, 114, 128, 0.2)", label: "" };

const STATUS_FILTER_STORAGE_KEY = "kuma-studio.plan-panel.hidden-statuses.v1";
const PANEL_COLLAPSED_STORAGE_KEY = "kuma-studio.plan-panel.collapsed.v1";
const EXPANDED_PROJECTS_STORAGE_KEY = "kuma-studio.plan-panel.expanded-projects.v1";

/** cancelled is treated as part of the completed filter family. */
export function canonicalFilterStatus(status: PlanStatus): string {
  return status === "cancelled" ? "completed" : status;
}

export function filterPlansByStatus(
  plans: Plan[],
  hidden: ReadonlySet<string>,
): Plan[] {
  if (hidden.size === 0) return plans;
  return plans.filter((plan) => !hidden.has(canonicalFilterStatus(plan.status)));
}

export function collectVisibleFilterStatuses(plans: Plan[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const plan of plans) {
    const key = canonicalFilterStatus(plan.status);
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered;
}

export function loadHiddenStatuses(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function saveHiddenStatuses(hidden: ReadonlySet<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STATUS_FILTER_STORAGE_KEY,
      JSON.stringify([...hidden]),
    );
  } catch {
    // storage unavailable; filter still works in-memory
  }
}

function loadBoolean(storageKey: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function saveBoolean(storageKey: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // storage unavailable; state still works in-memory
  }
}

function loadStringSet(storageKey: string) {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set<string>();
  }
}

function saveStringSet(storageKey: string, values: ReadonlySet<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...values]));
  } catch {
    // storage unavailable; state still works in-memory
  }
}

type PlanSourceStatus = "ready" | "missing_dir" | "misconfigured";
type PlanSourceInfo = {
  status?: PlanSourceStatus;
  configured?: boolean;
  exists?: boolean;
  workspaceRoot?: string | null;
  plansDir?: string | null;
};

function getStatusColor(status: PlanStatus) {
  return PLAN_STATUS_COLORS[status] ?? DEFAULT_STATUS_COLOR;
}

/** Sort plans by created date descending, fallback to id reverse-alpha. */
function sortPlansDesc(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => {
    const da = a.created ? new Date(a.created).getTime() : 0;
    const db = b.created ? new Date(b.created).getTime() : 0;
    if (da || db) return db - da;
    return b.id.localeCompare(a.id);
  });
}

/** Group sorted plans by project. */
function groupByProject(plans: Plan[]): Map<string, Plan[]> {
  const grouped = new Map<string, Plan[]>();
  for (const plan of plans) {
    const key = plan.project ?? "기타";
    const arr = grouped.get(key);
    if (arr) arr.push(plan);
    else grouped.set(key, [plan]);
  }
  return grouped;
}

export function getPlanPanelEmptyState(source?: PlanSourceInfo | null): {
  title: string;
  detail: string | null;
} {
  if (source?.status === "misconfigured") {
    return {
      title: "계획 문서 경로 미설정",
      detail: "워크스페이스 바인딩 없이 서버가 시작되어 계획 문서를 찾을 수 없습니다.",
    };
  }

  if (source?.status === "missing_dir") {
    return {
      title: "계획 폴더를 찾지 못했습니다",
      detail: source.plansDir ?? source.workspaceRoot ?? null,
    };
  }

  return {
    title: "계획문서 없음",
    detail: null,
  };
}

interface PlanPanelProps {
  activeProjectId?: string | null;
  activeProjectName?: string | null;
}

export function PlanPanel({ activeProjectId = null, activeProjectName = null }: PlanPanelProps) {
  const plans = useDashboardStore((s) => s.plans);
  const plansLoading = useDashboardStore((s) => s.plansLoading);
  const plansError = useDashboardStore((s) => s.plansError);
  const fetchPlans = useDashboardStore((s) => s.fetchPlans);
  const [collapsed, setCollapsed] = useState(() => loadBoolean(PANEL_COLLAPSED_STORAGE_KEY, true));
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => loadStringSet(EXPANDED_PROJECTS_STORAGE_KEY));
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(() => loadHiddenStatuses());

  useEffect(() => {
    void fetchPlans();
    const timer = setInterval(() => {
      void fetchPlans();
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchPlans]);

  const panelHeadingId = "plan-panel-heading";
  const planSource = (plans as { source?: PlanSourceInfo } | null)?.source;
  const emptyState = getPlanPanelEmptyState(planSource);
  const scopedPlans = useMemo(
    () => {
      const allPlans = plans?.plans ?? [];
      return activeProjectId
        ? allPlans.filter((plan) => plan.project === activeProjectId)
        : allPlans;
    },
    [activeProjectId, plans?.plans],
  );
  const total = scopedPlans.reduce((sum, plan) => sum + plan.totalItems, 0);
  const checked = scopedPlans.reduce((sum, plan) => sum + plan.checkedItems, 0);
  const rate = total > 0 ? Math.min(Math.max((checked / total) * 100, 0), 100) : 0;
  const headingScope = activeProjectName ?? activeProjectId;
  const scopedEmptyState = activeProjectId
    ? {
        title: "이 프로젝트 계획 없음",
        detail: headingScope ?? activeProjectId,
      }
    : emptyState;

  const sortedPlans = useMemo(
    () => sortPlansDesc(scopedPlans),
    [scopedPlans],
  );

  const visibleFilterStatuses = useMemo(
    () => collectVisibleFilterStatuses(sortedPlans),
    [sortedPlans],
  );

  const filteredPlans = useMemo(
    () => filterPlansByStatus(sortedPlans, hiddenStatuses),
    [sortedPlans, hiddenStatuses],
  );

  const groupedPlans = useMemo(
    () => groupByProject(filteredPlans),
    [filteredPlans],
  );

  function toggleStatusFilter(status: string) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      saveHiddenStatuses(next);
      return next;
    });
  }

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      saveBoolean(PANEL_COLLAPSED_STORAGE_KEY, next);
      return next;
    });
  }

  useEffect(() => {
    if (!selectedPlan) return;
    const next = sortedPlans.find((p) => p.id === selectedPlan.id);
    if (!next) {
      setIsDetailOpen(false);
      setSelectedPlan(null);
    } else if (next !== selectedPlan) {
      setSelectedPlan(next);
    }
  }, [selectedPlan, sortedPlans]);

  function openPlanDetail(plan: Plan) {
    setSelectedPlan(plan);
    setIsDetailOpen(true);
  }

  function closePlanDetail() {
    setIsDetailOpen(false);
    setSelectedPlan(null);
  }

  function toggleProject(project: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      saveStringSet(EXPANDED_PROJECTS_STORAGE_KEY, next);
      return next;
    });
  }

  return (
    <>
      <section
        aria-labelledby={panelHeadingId}
        className="rounded-2xl border shadow-lg backdrop-blur-md overflow-hidden"
        style={{ borderColor: "var(--panel-border)", background: "var(--panel-bg)" }}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex w-full min-w-0 items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <span
            id={panelHeadingId}
            className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--t-muted)" }}
          >
            계획 진행률{headingScope ? ` · ${headingScope}` : ""} {total > 0 ? `(${checked}/${total})` : ""}
          </span>
          <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>

        {!collapsed && (
        <div className="px-3 pb-3 space-y-1.5">
        {plansError && (
          <p
            className="mb-2 text-[10px]"
            style={{ color: "var(--toast-error-text)" }}
            role="status"
            aria-live="polite"
          >
            {plans ? "최신 계획 문서를 불러오지 못해 마지막 스냅샷을 표시합니다." : "계획 문서를 불러오지 못했습니다."}
          </p>
        )}

        {!plans && plansLoading ? (
          <p
            className="text-[10px]"
            style={{ color: "var(--t-faint)" }}
            role="status"
            aria-live="polite"
          >
            계획 문서 불러오는 중
          </p>
        ) : !plans ? null : sortedPlans.length === 0 ? (
          <div className="space-y-1">
            <p
              className="text-[10px]"
              style={{ color: "var(--t-faint)" }}
            >
              {scopedEmptyState.title}
            </p>
            {scopedEmptyState.detail && (
              <p
                className="break-all text-[9px]"
                style={{ color: "var(--t-faint)" }}
              >
                {scopedEmptyState.detail}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Overall progress */}
            <div className="flex items-center justify-between">
              <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>전체</span>
              <span className="text-xs font-bold" style={{ color: "var(--t-primary)" }}>
                {checked}/{total}
                <span className="ml-1 text-[10px] font-normal" style={{ color: "var(--t-faint)" }}>
                  {rate.toFixed(0)}%
                </span>
              </span>
            </div>

            <div
              className="h-1.5 overflow-hidden rounded-full"
              style={{ background: "var(--track-bg)" }}
              role="progressbar"
              aria-label="전체 계획 완료율"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(rate)}
            >
              <div
                className="h-full rounded-full bg-green-600 transition-all duration-500"
                style={{ width: `${rate}%` }}
              />
            </div>

            {/* Status filters */}
            {visibleFilterStatuses.length > 0 && (
              <div
                className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 border-t pt-1.5"
                style={{ borderColor: "var(--border-subtle)" }}
                role="group"
                aria-label="상태별 필터"
              >
                {visibleFilterStatuses.map((status) => {
                  const sc = getStatusColor(status);
                  const checked = !hiddenStatuses.has(status);
                  const label = sc.label || status;
                  return (
                    <label
                      key={status}
                      className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors"
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStatusFilter(status)}
                        aria-label={`${label} 상태 표시`}
                        className="h-3 w-3 shrink-0 cursor-pointer accent-green-600"
                      />
                      <span
                        className="shrink-0 rounded-full"
                        style={{
                          width: 6,
                          height: 6,
                          backgroundColor: sc.dot,
                          opacity: checked ? 1 : 0.4,
                        }}
                      />
                      <span
                        className="text-[9px]"
                        style={{ color: checked ? "var(--t-secondary)" : "var(--t-faint)" }}
                      >
                        {label}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Project tree */}
            <div
              className="mt-1.5 space-y-0.5 border-t pt-1.5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {Array.from(groupedPlans.entries()).map(([project, projectPlans]) => {
                const pChecked = projectPlans.reduce((s, p) => s + p.checkedItems, 0);
                const pTotal = projectPlans.reduce((s, p) => s + p.totalItems, 0);
                const isExpanded = expandedProjects.has(project);

                return (
                  <div key={project}>
                    {/* Project folder row */}
                    <button
                      type="button"
                      onClick={() => toggleProject(project)}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left transition-colors"
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span className="text-[9px] shrink-0" style={{ color: "var(--t-faint)" }}>
                        {isExpanded ? "▾" : "▸"}
                      </span>
                      <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ color: "var(--t-faint)" }}>
                        {isExpanded
                          ? <path d="M1.5 4.5h13l-1.5 9h-10z" strokeLinejoin="round" />
                          : <path d="M1.5 3.5h5l1.5 2h6.5v8h-13z" strokeLinejoin="round" />
                        }
                      </svg>
                      <span
                        className="flex-1 truncate text-[10px] font-bold"
                        style={{ color: "var(--t-secondary)" }}
                      >
                        {project}
                      </span>
                      <span
                        className="text-[8px] font-mono shrink-0"
                        style={{ color: "var(--t-faint)" }}
                      >
                        {pChecked}/{pTotal}
                      </span>
                    </button>

                    {/* Plan files */}
                    {isExpanded && (
                      <div className="ml-3 space-y-px border-l pl-2" style={{ borderColor: "var(--border-subtle)" }}>
                        {projectPlans.map((plan) => {
                          const planRate = plan.totalItems > 0
                            ? (plan.checkedItems / plan.totalItems) * 100
                            : 0;
                          const isComplete = planRate >= 100;
                          const sc = getStatusColor(plan.status);
                          return (
                            <button
                              key={plan.id}
                              type="button"
                              onClick={() => openPlanDetail(plan)}
                              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors"
                              style={{ background: `linear-gradient(90deg, ${sc.dot}08 0%, transparent 40%)` }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = `linear-gradient(90deg, ${sc.dot}18 0%, var(--panel-hover) 40%)`; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = `linear-gradient(90deg, ${sc.dot}08 0%, transparent 40%)`; }}
                            >
                              {/* Status dot with glow */}
                              <span
                                className="shrink-0 rounded-full"
                                style={{
                                  width: 6,
                                  height: 6,
                                  backgroundColor: sc.dot,
                                  boxShadow: `0 0 6px ${sc.glow}`,
                                }}
                                title={sc.label || plan.status}
                              />
                              <span
                                className="flex-1 truncate text-[9px]"
                                style={{ color: isComplete ? "var(--t-muted)" : "var(--t-primary)" }}
                                title={plan.title}
                              >
                                {plan.title}
                              </span>
                              <span
                                className="text-[7px] font-mono shrink-0"
                                style={{ color: sc.dot }}
                              >
                                {plan.checkedItems}/{plan.totalItems}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
        )}
      </section>

      {selectedPlan && createPortal(
        <PlanDetailModal
          plan={selectedPlan}
          isOpen={isDetailOpen}
          onClose={closePlanDetail}
        />,
        document.body,
      )}
    </>
  );
}
