import { useEffect } from "react";
import type { Plan, PlanStatus } from "../../types/plan";
import { MarkdownBody } from "./MarkdownBody";

interface PlanDetailModalProps {
  plan: Plan;
  onClose: () => void;
  isOpen: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  active:
    "border-blue-300/60 bg-blue-50/80 text-blue-700 shadow-blue-100/50",
  completed:
    "border-emerald-300/60 bg-emerald-50/80 text-emerald-700 shadow-emerald-100/50",
  in_progress:
    "border-blue-300/60 bg-blue-50/80 text-blue-700 shadow-blue-100/50",
  hold:
    "border-amber-300/60 bg-amber-50/80 text-amber-700 shadow-amber-100/50",
  blocked:
    "border-orange-300/60 bg-orange-50/80 text-orange-700 shadow-orange-100/50",
  draft:
    "border-stone-300/60 bg-stone-100/80 text-stone-600 shadow-stone-100/50",
  archived:
    "border-stone-300/60 bg-stone-100/80 text-stone-500 shadow-stone-100/50",
  failed:
    "border-rose-300/60 bg-rose-50/80 text-rose-700 shadow-rose-100/50",
  error:
    "border-rose-300/60 bg-rose-50/80 text-rose-700 shadow-rose-100/50",
};

const STATUS_LABELS: Partial<Record<PlanStatus, string>> = {
  active: "진행 중",
  completed: "완료",
  in_progress: "진행 중",
  hold: "보류",
  blocked: "막힘",
  draft: "초안",
  archived: "보관",
  failed: "실패",
  error: "오류",
};

const STATUS_STYLES_BY_COLOR: Record<string, string> = {
  blue: STATUS_STYLES.active,
  yellow: STATUS_STYLES.hold,
  orange: STATUS_STYLES.blocked,
  green: STATUS_STYLES.completed,
  red: STATUS_STYLES.failed,
  gray: STATUS_STYLES.draft,
};

/** Map completion percentage to a flat solid color */
function progressColor(rate: number): string {
  if (rate >= 100) return "bg-green-600";
  if (rate >= 70) return "bg-green-500";
  if (rate >= 40) return "bg-stone-500";
  return "bg-stone-400";
}

export function PlanDetailModal({
  plan,
  onClose,
  isOpen,
}: PlanDetailModalProps) {
  const hasBody = (plan.body ?? "").trim().length > 0;

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
    STATUS_STYLES_BY_COLOR[plan.statusColor] ??
    STATUS_STYLES[plan.status] ??
    "border-stone-300/60 bg-stone-100/80 text-stone-600";
  const statusLabel =
    STATUS_LABELS[plan.status] ?? plan.status.replace(/_/g, " ");
  const planFilePath = plan.filePath || `${plan.id}.md`;

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
            <div className="min-w-0 space-y-3">
              <div className="min-w-0 space-y-1">
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
                <div className="flex max-w-full items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--t-faint)" }}>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="h-3 w-3 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 1.75h5.25L12 4.5v9.75H4z" />
                    <path d="M9.25 1.75V4.5H12" />
                  </svg>
                  <span className="min-w-0 truncate" title={planFilePath}>
                    {planFilePath}
                  </span>
                </div>
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

        {/* Scrollable content — full markdown */}
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          {hasBody ? (
            <MarkdownBody content={plan.body} />
          ) : (
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
