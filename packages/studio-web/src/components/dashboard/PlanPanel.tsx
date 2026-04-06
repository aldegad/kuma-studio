import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import type { Plan } from "../../types/plan";
import { PlanDetailModal } from "./PlanDetailModal";

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

export function PlanPanel() {
  const plans = useDashboardStore((s) => s.plans);
  const plansLoading = useDashboardStore((s) => s.plansLoading);
  const plansError = useDashboardStore((s) => s.plansError);
  const fetchPlans = useDashboardStore((s) => s.fetchPlans);
  const [collapsed, setCollapsed] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);

  useEffect(() => {
    void fetchPlans();
    const timer = setInterval(() => {
      void fetchPlans();
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchPlans]);

  const total = plans?.totalItems ?? 0;
  const checked = plans?.checkedItems ?? 0;
  const rate = Number.isFinite(plans?.overallCompletionRate)
    ? Math.min(Math.max(plans?.overallCompletionRate ?? 0, 0), 100)
    : 0;
  const panelHeadingId = "plan-panel-heading";

  const sortedPlans = useMemo(
    () => sortPlansDesc(plans?.plans ?? []),
    [plans?.plans],
  );

  const groupedPlans = useMemo(
    () => groupByProject(sortedPlans),
    [sortedPlans],
  );

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

  return (
    <>
      <section
        aria-labelledby={panelHeadingId}
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
          <span
            id={panelHeadingId}
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--t-muted)" }}
          >
            계획 진행률 {total > 0 ? `(${checked}/${total})` : ""}
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
        ) : !plans ? null : total === 0 ? (
          <p
            className="text-[10px]"
            style={{ color: "var(--t-faint)" }}
          >
            계획문서 없음
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span
                className="text-[10px]"
                style={{ color: "var(--t-muted)" }}
              >
                전체
              </span>
              <span
                className="text-xs font-bold"
                style={{ color: "var(--t-primary)" }}
              >
                {checked}/{total}
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

            <div className="flex items-center justify-between">
              <span
                className="text-[10px]"
                style={{ color: "var(--t-muted)" }}
              >
                완료율
              </span>
              <span
                className={`text-xs font-bold ${
                  rate >= 80
                    ? "text-green-500"
                    : rate >= 50
                      ? "text-stone-500"
                      : "text-red-500"
                }`}
              >
                {rate.toFixed(0)}%
              </span>
            </div>

            {sortedPlans.length > 0 && (
              <div
                className="mt-1 space-y-1 border-t pt-1.5"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                {Array.from(groupedPlans.entries()).map(([project, projectPlans]) => (
                  <div key={project} className="flex items-center justify-between">
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: "var(--t-faint)" }}
                    >
                      {project}
                    </span>
                    <span
                      className="text-[8px] font-mono"
                      style={{ color: "var(--t-faint)" }}
                    >
                      {projectPlans.reduce((s, p) => s + p.checkedItems, 0)}/{projectPlans.reduce((s, p) => s + p.totalItems, 0)}
                    </span>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setIsOverviewOpen(true)}
                  className="mt-1 w-full rounded-lg border py-1.5 text-[10px] font-bold transition-colors"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: "var(--t-secondary)",
                    background: "var(--card-bg)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--card-bg)"; }}
                >
                  전체보기
                </button>
              </div>
            )}
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

      {isOverviewOpen && createPortal(
        <PlansOverviewModal
          groupedPlans={groupedPlans}
          total={total}
          checked={checked}
          rate={rate}
          onSelectPlan={openPlanDetail}
          onClose={() => setIsOverviewOpen(false)}
        />,
        document.body,
      )}
    </>
  );
}

/* ─── Plans Overview Modal ─── */

interface PlansOverviewModalProps {
  groupedPlans: Map<string, Plan[]>;
  total: number;
  checked: number;
  rate: number;
  onSelectPlan: (plan: Plan) => void;
  onClose: () => void;
}

function PlansOverviewModal({
  groupedPlans,
  total,
  checked,
  rate,
  onSelectPlan,
  onClose,
}: PlansOverviewModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="계획 전체보기"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] backdrop-blur-md"
        style={{
          background: "var(--panel-bg-strong)",
          borderColor: "var(--panel-border)",
          animation: "planModalIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--card-bg)" }}
        >
          <div className="space-y-2 min-w-0 flex-1">
            <h2 className="text-sm font-bold" style={{ color: "var(--t-primary)" }}>
              계획 진행률
            </h2>
            <div className="flex items-center gap-3">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: "var(--track-bg)" }}
              >
                <div
                  className="h-full rounded-full bg-green-600 transition-all duration-500"
                  style={{ width: `${rate}%` }}
                />
              </div>
              <span className="text-xs font-bold font-mono" style={{ color: "var(--t-primary)" }}>
                {checked}/{total}
                <span className="ml-1" style={{ color: "var(--t-faint)" }}>
                  ({rate.toFixed(0)}%)
                </span>
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 shrink-0 rounded-xl border p-2 shadow-sm transition-all duration-200"
            style={{ borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-faint)" }}
            aria-label="닫기"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M5 5l10 10" />
              <path d="M15 5L5 15" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
          {Array.from(groupedPlans.entries()).map(([project, projectPlans]) => {
            const pChecked = projectPlans.reduce((s, p) => s + p.checkedItems, 0);
            const pTotal = projectPlans.reduce((s, p) => s + p.totalItems, 0);
            const pRate = pTotal > 0 ? (pChecked / pTotal) * 100 : 0;

            return (
              <section key={project}>
                {/* Project header */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: "var(--t-secondary)" }}
                  >
                    {project}
                  </span>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1 w-12 overflow-hidden rounded-full"
                      style={{ background: "var(--track-bg)" }}
                    >
                      <div
                        className="h-full rounded-full bg-green-600"
                        style={{ width: `${pRate}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono" style={{ color: "var(--t-muted)" }}>
                      {pChecked}/{pTotal}
                    </span>
                  </div>
                </div>

                {/* Plans in this project */}
                <div className="space-y-1.5 pl-1">
                  {projectPlans.map((plan) => {
                    const planRate = plan.totalItems > 0
                      ? (plan.checkedItems / plan.totalItems) * 100
                      : 0;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => onSelectPlan(plan)}
                        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
                        style={{
                          borderColor: "var(--card-border)",
                          background: "var(--card-bg)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--card-bg)"; }}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium" style={{ color: "var(--t-primary)" }}>
                            {plan.title}
                          </span>
                          {plan.created && (
                            <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>
                              {plan.created}
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <div
                            className="h-1 w-10 overflow-hidden rounded-full"
                            style={{ background: "var(--track-bg)" }}
                          >
                            <div
                              className="h-full rounded-full bg-stone-400"
                              style={{ width: `${planRate}%` }}
                            />
                          </div>
                          <span className="text-[9px] font-mono" style={{ color: "var(--t-muted)" }}>
                            {plan.checkedItems}/{plan.totalItems}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes planModalIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
