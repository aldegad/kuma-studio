import { useEffect, useState } from "react";
import type { Plan, PlanStatus } from "../../types/plan";
import { MarkdownBody } from "./MarkdownBody";

interface PlanDetailModalProps {
  plan: Plan;
  onClose: () => void;
  isOpen: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  completed:
    "border-emerald-300/60 bg-emerald-50/80 text-emerald-700 shadow-emerald-100/50",
  in_progress:
    "border-stone-400/60 bg-stone-100/80 text-stone-700 shadow-stone-100/50",
  blocked:
    "border-stone-400/60 bg-stone-200/80 text-stone-600 shadow-stone-100/50",
  draft:
    "border-stone-300/60 bg-stone-100/80 text-stone-600 shadow-stone-100/50",
  archived:
    "border-stone-300/60 bg-stone-100/80 text-stone-500 shadow-stone-100/50",
  error:
    "border-rose-300/60 bg-rose-50/80 text-rose-700 shadow-rose-100/50",
};

const STATUS_LABELS: Partial<Record<PlanStatus, string>> = {
  completed: "완료",
  in_progress: "진행 중",
  blocked: "중단",
  draft: "초안",
  archived: "보관",
  error: "오류",
};

/** Map completion percentage to a flat solid color */
function progressColor(rate: number): string {
  if (rate >= 100) return "bg-green-600";
  if (rate >= 70) return "bg-green-500";
  if (rate >= 40) return "bg-stone-500";
  return "bg-stone-400";
}

/** Section icon SVGs based on index position */
function sectionIcon(index: number) {
  const icons = [
    <svg key="i" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10l7-7 7 7" /><path d="M5 8v8h10V8" /></svg>,
    <svg key="ii" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7l-4 3 4 3" /><path d="M13 7l4 3-4 3" /><path d="M11 5l-2 10" /></svg>,
    <svg key="iii" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4 4 8-8" /></svg>,
    <svg key="iv" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3c3 3 4 6 4 10H6c0-4 1-7 4-10z" /><path d="M8 17h4" /><path d="M10 13v4" /></svg>,
    <svg key="v" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 5l2 2-2 2" /><path d="M4 10a6 6 0 0110-3" /><path d="M6 15l-2-2 2-2" /><path d="M16 10a6 6 0 01-10 3" /></svg>,
  ];
  return icons[index % icons.length];
}

type ViewTab = "checklist" | "document";

export function PlanDetailModal({
  plan,
  onClose,
  isOpen,
}: PlanDetailModalProps) {
  const hasBody = (plan.body ?? "").trim().length > 0;
  const hasSections = plan.sections.length > 0;
  const showTabs = hasBody && hasSections;
  const [activeTab, setActiveTab] = useState<ViewTab>(hasBody ? "document" : "checklist");

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const safeRate = Number.isFinite(plan.completionRate)
    ? Math.min(Math.max(plan.completionRate, 0), 100)
    : 0;
  const statusClassName =
    STATUS_STYLES[plan.status] ??
    "border-stone-300/60 bg-stone-100/80 text-stone-600";
  const statusLabel =
    STATUS_LABELS[plan.status] ?? plan.status.replace(/_/g, " ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`plan-detail-title-${plan.id}`}
        className="w-full max-w-3xl overflow-hidden rounded-2xl border shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all duration-300"
        style={{
          background: "var(--panel-bg-strong)",
          borderColor: "var(--panel-border)",
          animation: "planModalIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--card-bg)" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2
                  id={`plan-detail-title-${plan.id}`}
                  className="text-lg font-bold tracking-tight"
                  style={{ color: "var(--t-primary)" }}
                >
                  {plan.title}
                </h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] shadow-sm ${statusClassName}`}
                >
                  {statusLabel}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-faint)" }}>
                    전체 진행 상황
                  </span>
                  <span className="font-mono text-xs font-bold" style={{ color: "var(--t-secondary)" }}>
                    {plan.checkedItems}/{plan.totalItems}
                    <span className="ml-1.5" style={{ color: "var(--t-faint)" }}>
                      {safeRate.toFixed(0)}%
                    </span>
                  </span>
                </div>

                <div className="relative h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--card-bg)" }}>
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${progressColor(safeRate)} transition-all duration-700 ease-out`}
                    style={{ width: `${safeRate}%` }}
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="group rounded-xl border p-2 shadow-sm transition-all duration-200"
              style={{ borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-faint)" }}
              aria-label="계획 상세 닫기"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-4 w-4 transition-transform duration-200 group-hover:scale-110"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M5 5l10 10" />
                <path d="M15 5L5 15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab toggle */}
        {showTabs && (
          <div
            className="flex gap-0 px-6"
            style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--card-bg)" }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("document")}
              className="relative px-4 py-2.5 text-[11px] font-bold tracking-wide transition-colors"
              style={{
                color: activeTab === "document" ? "var(--t-primary)" : "var(--t-faint)",
              }}
            >
              문서
              {activeTab === "document" && (
                <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-green-600" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("checklist")}
              className="relative px-4 py-2.5 text-[11px] font-bold tracking-wide transition-colors"
              style={{
                color: activeTab === "checklist" ? "var(--t-primary)" : "var(--t-faint)",
              }}
            >
              체크리스트
              <span className="ml-1 font-mono text-[10px]" style={{ color: "var(--t-faint)" }}>
                {plan.checkedItems}/{plan.totalItems}
              </span>
              {activeTab === "checklist" && (
                <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-green-600" />
              )}
            </button>
          </div>
        )}

        {/* Scrollable content */}
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          {/* Document view */}
          {(activeTab === "document" || !showTabs) && hasBody && (
            <MarkdownBody content={plan.body} />
          )}

          {/* Checklist view */}
          {(activeTab === "checklist" || !showTabs) && hasSections && (
            <div className={`space-y-4 ${showTabs && activeTab === "document" ? "hidden" : ""}`}>
              {plan.sections.map((section, sectionIndex) => {
                const checkedItems = section.items.filter(
                  (item) => item.checked,
                ).length;
                const totalItems = section.items.length;
                const sectionRate =
                  totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;
                const sectionComplete = sectionRate >= 100;

                return (
                  <section
                    key={`${plan.id}-${section.title || "untitled"}-${sectionIndex}`}
                    className="group/section rounded-xl border shadow-sm transition-all duration-200"
                    style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
                  >
                    {/* Section header */}
                    <div className="flex items-center justify-between gap-3 rounded-t-xl px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--card-bg)" }}>
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-lg shadow-sm transition-colors ${
                            sectionComplete
                              ? "border border-green-200/60 bg-green-50 text-green-700"
                              : ""
                          }`}
                          style={sectionComplete ? undefined : { borderWidth: 1, borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-secondary)" }}
                        >
                          {sectionIcon(sectionIndex)}
                        </span>
                        <div>
                          <h3 className="text-[13px] font-bold" style={{ color: "var(--t-primary)" }}>
                            {section.title || "기타"}
                          </h3>
                          <p className="text-[10px]" style={{ color: "var(--t-faint)" }}>
                            체크리스트 진행 상황
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold shadow-sm ${
                          sectionComplete
                            ? "border border-green-200/60 bg-green-50/80 text-green-700"
                            : ""
                        }`}
                        style={sectionComplete ? undefined : { borderWidth: 1, borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-secondary)" }}
                      >
                        {checkedItems}/{totalItems}
                      </span>
                    </div>

                    {/* Section progress bar */}
                    <div className="px-4 pt-3">
                      <div className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--card-bg)" }}>
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full ${progressColor(sectionRate)} transition-all duration-500 ease-out`}
                          style={{ width: `${sectionRate}%` }}
                        />
                      </div>
                    </div>

                    {/* Checklist items */}
                    <ul className="space-y-1.5 px-4 pb-4 pt-3">
                      {section.items.map((item, itemIndex) => (
                        <li
                          key={`${plan.id}-${sectionIndex}-${item.text}-${itemIndex}`}
                          className={`group/item rounded-lg border px-3 py-2.5 transition-all duration-200 ${
                            item.checked
                              ? "border-emerald-200/50 bg-emerald-50/40 hover:border-emerald-200/70 hover:bg-emerald-50/60"
                              : ""
                          }`}
                          style={item.checked ? undefined : { borderColor: "var(--card-border)", background: "var(--card-bg)" }}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              aria-hidden="true"
                              className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-all duration-200 ${
                                item.checked
                                  ? "border-emerald-400/80 bg-emerald-500 text-white shadow-sm shadow-emerald-200/50"
                                  : "text-transparent"
                              }`}
                              style={item.checked ? undefined : { borderColor: "var(--card-border)", background: "var(--input-bg)" }}
                            >
                              <svg
                                viewBox="0 0 16 16"
                                className="h-3 w-3"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M3.5 8.5l3 3 6-7" />
                              </svg>
                            </span>

                            <div className="min-w-0 flex-1 space-y-1.5">
                              <p
                                className="text-[13px] leading-relaxed transition-colors"
                                style={{ color: item.checked ? "var(--t-secondary)" : "var(--t-primary)" }}
                              >
                                {item.text}
                              </p>

                              {item.commitHash && (
                                <span
                                  className="inline-flex max-w-full rounded-md border px-1.5 py-0.5 font-mono text-[9px] tracking-wide transition-colors"
                                  style={{ borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-faint)" }}
                                  title={item.commitHash}
                                >
                                  {item.commitHash}
                                </span>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}

          {/* Empty state — no body and no sections */}
          {!hasBody && !hasSections && (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm" style={{ borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-faint)" }}>
              표시할 콘텐츠가 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* Keyframe for entrance animation */}
      <style>{`
        @keyframes planModalIn {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
