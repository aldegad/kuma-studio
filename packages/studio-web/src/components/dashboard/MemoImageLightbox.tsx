import { createPortal } from "react-dom";

interface MemoImageLightboxProps {
  imageUrl: string | null;
  imageLabel: string;
  fileName: string;
  actionMessage?: string | null;
  busyAction?: "download" | "copy" | null;
  onDownload: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export function MemoImageLightbox({
  imageUrl,
  imageLabel,
  fileName,
  actionMessage,
  busyAction = null,
  onDownload,
  onCopy,
  onClose,
}: MemoImageLightboxProps) {
  if (!imageUrl) {
    return null;
  }

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="메모 이미지 팝업"
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col gap-3 rounded-2xl border p-4 shadow-2xl"
        style={{ background: "color-mix(in srgb, var(--panel-bg) 92%, black)", borderColor: "var(--panel-border)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" style={{ color: "var(--t-primary)" }}>
              {imageLabel}
            </p>
            <p className="truncate text-xs" style={{ color: "var(--t-faint)" }}>
              {fileName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownload}
              disabled={busyAction !== null}
              className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
              aria-label="메모 이미지 다운로드"
            >
              {busyAction === "download" ? "다운로드 중" : "다운로드"}
            </button>
            <button
              type="button"
              onClick={onCopy}
              disabled={busyAction !== null}
              className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
              aria-label="메모 이미지 클립보드 복사"
            >
              {busyAction === "copy" ? "복사 중" : "클립보드 복사"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs transition-colors"
              style={{ color: "var(--t-faint)" }}
              aria-label="메모 이미지 팝업 닫기"
            >
              닫기
            </button>
          </div>
        </div>

        {actionMessage ? (
          <p className="text-xs" role="status" style={{ color: "var(--t-muted)" }}>
            {actionMessage}
          </p>
        ) : null}

        <div className="overflow-auto rounded-xl bg-black/20 p-2">
          <img
            src={imageUrl}
            alt={imageLabel}
            className="max-h-[78vh] w-full rounded-xl object-contain"
          />
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !document.body) {
    return content;
  }

  return createPortal(content, document.body);
}
