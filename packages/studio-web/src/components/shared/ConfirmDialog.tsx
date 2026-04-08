import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    confirmRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* dialog card */}
      <div
        className="relative mx-4 w-full max-w-xs rounded-xl border-2 p-4 shadow-2xl"
        style={{
          background: "var(--panel-bg-strong)",
          borderColor: "var(--panel-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="text-sm font-bold mb-1"
          style={{ color: "var(--t-primary)" }}
        >
          {title}
        </p>
        <p
          className="text-[11px] leading-relaxed mb-4"
          style={{ color: "var(--t-secondary)" }}
        >
          {message}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition-colors"
            style={{
              background: "var(--btn-ghost-bg)",
              color: "var(--btn-ghost-text)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--btn-ghost-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--btn-ghost-bg)"; }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition-colors"
            style={{
              background: danger ? "var(--danger-text)" : "var(--btn-solid-bg)",
              color: danger ? "#fff" : "var(--btn-solid-text)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.85";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
