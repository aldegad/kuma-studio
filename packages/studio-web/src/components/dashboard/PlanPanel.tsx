import { useEffect, useState } from "react";
import { useDashboardStore } from "../../stores/use-dashboard-store";

interface PlanPanelProps {
  isNight?: boolean;
}

export function PlanPanel({ isNight = false }: PlanPanelProps) {
  const plans = useDashboardStore((s) => s.plans);
  const plansLoading = useDashboardStore((s) => s.plansLoading);
  const plansError = useDashboardStore((s) => s.plansError);
  const fetchPlans = useDashboardStore((s) => s.fetchPlans);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  function getPlanRegionId(planId: string) {
    return `plan-panel-${planId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  }

  return (
    <section
      aria-labelledby={panelHeadingId}
      className={`rounded-2xl border p-3 shadow-lg backdrop-blur-md ${
        isNight
          ? "border-indigo-800/40 bg-indigo-950/70"
          : "border-white/50 bg-white/75"
      }`}
    >
      <h3
        id={panelHeadingId}
        className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${
          isNight ? "text-indigo-400" : "text-stone-500"
        }`}
      >
        계획 진행률
      </h3>

      {plansError && (
        <p
          className={`mb-2 text-[10px] ${
            isNight ? "text-rose-300/80" : "text-rose-500"
          }`}
          role="status"
          aria-live="polite"
        >
          {plans ? "최신 계획 문서를 불러오지 못해 마지막 스냅샷을 표시합니다." : "계획 문서를 불러오지 못했습니다."}
        </p>
      )}

      {!plans && plansLoading ? (
        <p
          className={`text-[10px] ${
            isNight ? "text-indigo-300/60" : "text-stone-400"
          }`}
          role="status"
          aria-live="polite"
        >
          계획 문서 불러오는 중
        </p>
      ) : !plans ? null : total === 0 ? (
        <p
          className={`text-[10px] ${
            isNight ? "text-indigo-300/60" : "text-stone-400"
          }`}
        >
          계획문서 없음
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span
              className={`text-[10px] ${
                isNight ? "text-indigo-300" : "text-stone-500"
              }`}
            >
              전체
            </span>
            <span
              className={`text-xs font-bold ${
                isNight ? "text-white" : "text-stone-800"
              }`}
            >
              {checked}/{total}
            </span>
          </div>

          <div
            className={`h-1.5 overflow-hidden rounded-full ${
              isNight ? "bg-indigo-900" : "bg-stone-100"
            }`}
            role="progressbar"
            aria-label="전체 계획 완료율"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(rate)}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-indigo-500 transition-all duration-500"
              style={{ width: `${rate}%` }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span
              className={`text-[10px] ${
                isNight ? "text-indigo-300" : "text-stone-500"
              }`}
            >
              완료율
            </span>
            <span
              className={`text-xs font-bold ${
                rate >= 80
                  ? "text-green-500"
                  : rate >= 50
                    ? "text-amber-500"
                    : "text-red-500"
              }`}
            >
              {rate.toFixed(0)}%
            </span>
          </div>

          {visiblePlans.length > 0 && (
            <div
              className={`mt-1 space-y-1 border-t pt-1.5 ${
                isNight ? "border-indigo-800" : "border-stone-100"
              }`}
            >
              {visiblePlans.map((plan) => (
                <div key={plan.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setExpanded((current) => (current === plan.id ? null : plan.id))}
                    aria-expanded={expanded === plan.id}
                    aria-controls={getPlanRegionId(plan.id)}
                  >
                    <span
                      className={`max-w-[120px] truncate text-[10px] ${
                        isNight ? "text-indigo-200" : "text-stone-600"
                      }`}
                    >
                      {expanded === plan.id ? "\u25be" : "\u25b8"} {plan.title}
                    </span>
                    <span
                      className={`text-[10px] font-mono ${
                        isNight ? "text-indigo-400" : "text-stone-400"
                      }`}
                    >
                      {plan.checkedItems}/{plan.totalItems}
                    </span>
                  </button>

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
                              className={`max-w-[90px] truncate text-[9px] ${
                                isNight
                                  ? "text-indigo-300/70"
                                  : "text-stone-400"
                              }`}
                            >
                              {section.title || "기타"}
                            </span>
                            <div className="flex items-center gap-1">
                              <div
                                className={`h-1 w-8 overflow-hidden rounded-full ${
                                  isNight ? "bg-indigo-900" : "bg-stone-200"
                                }`}
                              >
                                <div
                                  className="h-full rounded-full bg-blue-400"
                                  style={{
                                    width: `${st > 0 ? (sc / st) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                              <span
                                className={`text-[8px] font-mono ${
                                  isNight ? "text-indigo-400" : "text-stone-400"
                                }`}
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
    </section>
  );
}
