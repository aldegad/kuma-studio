import { useEffect, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";

export type ExtensionDetailKind = "skill" | "catalog" | "plugin";

interface ExtensionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  kind: ExtensionDetailKind;
  title: string;
  subtitle?: string;
  body: string;
  editable?: boolean;
  editing?: boolean;
  saving?: boolean;
  editContent?: string;
  onEditToggle?: () => void;
  onEditChange?: (value: string) => void;
  onSave?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}

const KIND_BADGE: Record<ExtensionDetailKind, { label: string; className: string }> = {
  skill: {
    label: "Skill",
    className: "border-blue-300/60 bg-blue-50/80 text-blue-700 shadow-blue-100/50",
  },
  catalog: {
    label: "Catalog",
    className: "border-emerald-300/60 bg-emerald-50/80 text-emerald-700 shadow-emerald-100/50",
  },
  plugin: {
    label: "Plugin",
    className: "border-amber-300/60 bg-amber-50/80 text-amber-700 shadow-amber-100/50",
  },
};

export function ExtensionDetailModal({
  isOpen,
  onClose,
  kind,
  title,
  subtitle,
  body,
  editable = false,
  editing = false,
  saving = false,
  editContent = "",
  onEditToggle,
  onEditChange,
  onSave,
  onDelete,
  deleting = false,
}: ExtensionDetailModalProps) {
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const badge = KIND_BADGE[kind];
  const hasBody = (body ?? "").trim().length > 0;

  const handleDeleteClick = async () => {
    if (!onDelete) return;
    setLocalBusy(true);
    try {
      await Promise.resolve(onDelete());
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-detail-title"
        className="w-full max-w-3xl overflow-hidden rounded-2xl border shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all duration-300"
        style={{
          background: "var(--panel-bg-strong)",
          borderColor: "var(--panel-border)",
          animation: "extensionModalIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-5"
          style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--card-bg)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2
                  id="extension-detail-title"
                  className="truncate text-lg font-bold tracking-tight"
                  style={{ color: "var(--t-primary)" }}
                >
                  {title}
                </h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] shadow-sm ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>
              {subtitle && (
                <code
                  className="block truncate text-[10px]"
                  style={{ color: "var(--t-faint)" }}
                  title={subtitle}
                >
                  {subtitle}
                </code>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {editable && !editing && onEditToggle && (
                <button
                  type="button"
                  onClick={onEditToggle}
                  className="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    borderColor: "var(--card-border)",
                    background: "var(--card-bg)",
                    color: "var(--t-secondary)",
                  }}
                >
                  편집
                </button>
              )}
              {editable && onDelete && (
                <button
                  type="button"
                  onClick={() => void handleDeleteClick()}
                  disabled={deleting || localBusy}
                  className="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
                  style={{
                    borderColor: "var(--card-border)",
                    background: "var(--card-bg)",
                    color: "var(--toast-error-text)",
                  }}
                >
                  {deleting || localBusy ? "삭제 중" : "삭제"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="group rounded-xl border p-2 shadow-sm transition-all duration-200"
                style={{
                  borderColor: "var(--card-border)",
                  background: "var(--card-bg)",
                  color: "var(--t-faint)",
                }}
                aria-label="확장 상세 닫기"
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
        </div>

        {/* Scrollable content */}
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          {editing ? (
            <div className="space-y-3">
              <textarea
                value={editContent}
                onChange={(event) => onEditChange?.(event.target.value)}
                className="min-h-[360px] w-full resize-y rounded-lg border p-3 font-mono text-[11px] leading-relaxed outline-none"
                style={{
                  background: "var(--input-bg)",
                  borderColor: "var(--input-border)",
                  color: "var(--t-primary)",
                }}
                spellCheck={false}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onEditToggle}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-medium"
                  style={{ color: "var(--t-muted)" }}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => onSave?.()}
                  disabled={saving}
                  className="rounded-lg px-4 py-1.5 text-[11px] font-bold text-white transition-colors disabled:opacity-50"
                  style={{ background: "var(--btn-solid-bg)" }}
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          ) : hasBody ? (
            <div className="text-[12px] leading-relaxed">
              <MarkdownBody content={body} />
            </div>
          ) : (
            <div
              className="rounded-xl border border-dashed px-4 py-8 text-center text-sm"
              style={{
                borderColor: "var(--card-border)",
                background: "var(--card-bg)",
                color: "var(--t-faint)",
              }}
            >
              표시할 콘텐츠가 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* Keyframe for entrance animation */}
      <style>{`
        @keyframes extensionModalIn {
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
