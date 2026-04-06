import { useEffect, useState } from "react";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import type { Plan } from "../../types/plan";
import { PlanDetailModal } from "./PlanDetailModal";

export function PlanPanel() {
  const plans = useDashboardStore((s) => s.plans);
  const plansLoading = useDashboardStore((s) => s.plansLoading);
  const plansError = useDashboardStore((s) => s.plansError);
  const fetchPlans = useDashboardStore((s) => s.fetchPlans);
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
  const visiblePlans = plans?.plans ?? [];

  useEffect(() => {
    if (!selectedPlan) {
      return;
    }

    const nextSelectedPlan = visiblePlans.find((plan) => plan.id === selectedPlan.id);

    if (!nextSelectedPlan) {
      setIsModalOpen(false);
      setSelectedPlan(null);
      return;
    }

    if (nextSelectedPlan !== selectedPlan) {
      setSelectedPlan(nextSelectedPlan);
    }
  }, [selectedPlan, visiblePlans]);

  function getPlanRegionId(planId: string) {
    return `plan-panel-${planId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  }

  function openPlanDetail(plan: Plan) {
    setSelectedPlan(plan);
    setIsModalOpen(true);
  }

  function closePlanDetail() {
    setIsModalOpen(false);
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

            {visiblePlans.length > 0 && (
              <div
                className="mt-1 space-y-1 border-t pt-1.5"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                {visiblePlans.map((plan) => (
                  <div key={plan.id}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-between text-left"
                        onClick={() => setExpanded((current) => (current === plan.id ? null : plan.id))}
                        aria-expanded={expanded === plan.id}
                        aria-controls={getPlanRegionId(plan.id)}
                      >
                        <span
                          className="max-w-[120px] truncate text-[10px]"
                          style={{ color: "var(--t-secondary)" }}
                        >
                          {expanded === plan.id ? "\u25be" : "\u25b8"} {plan.title}
                        </span>
                        <span
                          className="text-[10px] font-mono"
                          style={{ color: "var(--t-muted)" }}
                        >
                          {plan.checkedItems}/{plan.totalItems}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openPlanDetail(plan)}
                        className="shrink-0 rounded-md p-1 opacity-50 transition-opacity hover:opacity-100"
                        style={{ color: "var(--t-muted)" }}
                        aria-label={`${plan.title} 상세 보기`}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M7 3H3v4" />
                          <path d="M13 3h4v4" />
                          <path d="M17 13v4h-4" />
                          <path d="M3 13v4h4" />
                          <path d="M7 3L3 7" />
                          <path d="M13 3l4 4" />
                          <path d="M17 13l-4 4" />
                          <path d="M3 13l4 4" />
                        </svg>
                      </button>
                    </div>

                    {expanded === plan.id && (
                      <div
                        id={getPlanRegionId(plan.id)}
                        className="mt-1 space-y-1 pl-2"
                      >
                        {plan.sections.map((section, i) => {
                          const sc = section.items.filter(
                            (item) => item.checked,
                          ).length;
                          const st = section.items.length;
                          return (
                            <div
                              key={`${plan.id}-${section.title || "untitled"}-${i}`}
                              className="flex items-center justify-between gap-1"
                            >
                              <span
                                className="max-w-[90px] truncate text-[9px]"
                                style={{ color: "var(--t-faint)" }}
                              >
                                {section.title || "기타"}
                              </span>
                              <div className="flex items-center gap-1">
                                <div
                                  className="h-1 w-8 overflow-hidden rounded-full"
                                  style={{ background: "var(--track-bg)" }}
                                >
                                  <div
                                    className="h-full rounded-full bg-stone-400"
                                    style={{
                                      width: `${st > 0 ? (sc / st) * 100 : 0}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  className="text-[8px] font-mono"
                                  style={{ color: "var(--t-muted)" }}
                                >
                                  {sc}/{st}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
        )}
      </section>

      {selectedPlan && (
        <PlanDetailModal
          plan={selectedPlan}
          isOpen={isModalOpen}
          onClose={closePlanDetail}
        />
      )}
    </>
  );
}
