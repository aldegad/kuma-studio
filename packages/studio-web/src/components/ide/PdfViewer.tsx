import { useEffect, useState } from "react";

interface PdfViewerProps {
  content: string;
  mimeType: string;
  filePath: string;
  onClose: () => void;
  inline?: boolean;
}

export function PdfViewer({ content, mimeType, filePath, onClose, inline }: PdfViewerProps) {
  const fileName = filePath.split("/").pop() || filePath;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let activeUrl: string | null = null;
    const binary = window.atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: mimeType });
    activeUrl = URL.createObjectURL(blob);
    setSrc(activeUrl);

    return () => {
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
    };
  }, [content, mimeType]);

  const openInNewTab = () => {
    if (!src) return;
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  };

  const viewer = (
    <div
      className={
        inline
          ? "flex h-full min-h-0 w-full flex-col overflow-hidden"
          : "relative mx-4 flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)]"
      }
      onClick={inline ? undefined : (event) => event.stopPropagation()}
      style={{
        background: "var(--ide-bg-alt)",
        borderColor: "var(--card-border)",
        ...(inline ? {} : { animation: "slideUp 200ms ease-out" }),
      }}
    >
      <div
        className="flex items-center border-b"
        style={{ borderColor: "var(--card-border)", background: "linear-gradient(to bottom, var(--ide-header-from), var(--ide-header-to))" }}
      >
        <div className="flex min-w-0 items-center gap-2 border-b-2 border-rose-400 px-4 py-2" style={{ background: "var(--ide-bg-alt)" }}>
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0" style={{ color: "var(--t-faint)" }} fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M4.5 1.5h5l3 3v9.5a1 1 0 01-1 1h-7a1 1 0 01-1-1v-11.5a1 1 0 011-1z" />
            <path d="M9.5 1.5v3h3" />
            <path d="M5.4 11.2V8.7h1.3c.9 0 1.4.4 1.4 1.2 0 .8-.5 1.3-1.4 1.3H6.2v1zM9.2 11.2V8.7h1.1c1 0 1.7.5 1.7 1.2 0 .8-.6 1.3-1.7 1.3H9.9v1z" />
          </svg>
          <span className="truncate text-[12px] font-medium" style={{ color: "var(--t-secondary)" }}>{fileName}</span>
          <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">PDF</span>
        </div>
        <div className="flex-1" />
        <span
          className="mr-1 rounded px-2 py-0.5 text-[10px] font-medium"
          style={{ color: "var(--t-primary)", background: "var(--badge-bg)" }}
        >
          프리뷰
        </span>
        <button
          type="button"
          onClick={openInNewTab}
          disabled={!src}
          className="mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
          style={{ color: src ? "var(--t-faint)" : "var(--t-faint)", opacity: src ? 1 : 0.45 }}
          title="새 탭에서 열기"
        >
          새 탭
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mr-2 rounded p-1 transition-colors"
          style={{ color: "var(--t-faint)" }}
          title="닫기 (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div
        className={inline ? "min-h-0 flex-1 p-2" : "min-h-0 flex-1 p-4"}
        style={{ background: "var(--ide-bg)" }}
      >
        <div
          className={`h-full min-h-0 overflow-hidden border bg-white shadow-[0_12px_30px_-18px_rgba(15,23,42,0.45)] ${inline ? "rounded-md" : "rounded-lg"}`}
          style={{ borderColor: "var(--card-border)" }}
        >
          {src ? (
            <iframe
              src={src}
              title={fileName}
              className="h-full min-h-[78vh] w-full"
            />
          ) : (
            <div className="flex h-full min-h-[320px] items-center justify-center text-[11px]" style={{ color: "var(--t-faint)" }}>
              PDF 준비 중...
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) return viewer;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[6px]"
      onClick={onClose}
      style={{ animation: "fadeIn 150ms ease-out" }}
    >
      {viewer}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
    </div>
  );
}
