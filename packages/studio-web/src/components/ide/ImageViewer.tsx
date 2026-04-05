interface ImageViewerProps {
  content: string;
  mimeType: string;
  filePath: string;
  onClose: () => void;
  inline?: boolean;
}

export function ImageViewer({ content, mimeType, filePath, onClose, inline }: ImageViewerProps) {
  const fileName = filePath.split("/").pop() || filePath;
  const src = `data:${mimeType};base64,${content}`;
  const ext = (mimeType.split("/").pop() || "").toUpperCase();

  const viewer = (
    <div
      className={
        inline
          ? "flex h-full w-full flex-col overflow-hidden bg-white"
          : "relative mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-stone-200/80 bg-white shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)]"
      }
      onClick={inline ? undefined : (e) => e.stopPropagation()}
      style={inline ? undefined : { animation: "slideUp 200ms ease-out" }}
    >
      {/* Tab bar header */}
      <div className="flex items-center border-b border-stone-200/80 bg-gradient-to-b from-stone-100 to-stone-50">
        <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-teal-400 bg-white min-w-0">
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-teal-500" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <circle cx="6" cy="6" r="1.5" />
            <path d="M2 11l3-3 2 2 3-3 4 4v1a2 2 0 01-2 2H4a2 2 0 01-2-2v-1z" fill="currentColor" opacity="0.3" />
          </svg>
          <span className="truncate text-[12px] font-medium text-stone-700">{fileName}</span>
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold bg-teal-100 text-teal-700">
            {ext}
          </span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 mr-2 rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/80 hover:text-stone-600"
          title="닫기 (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Image area — checkerboard bg for transparency */}
      <div
        className="flex flex-1 items-center justify-center overflow-auto p-6"
        style={{
          backgroundImage: `linear-gradient(45deg, #f5f5f4 25%, transparent 25%), linear-gradient(-45deg, #f5f5f4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f5f5f4 75%), linear-gradient(-45deg, transparent 75%, #f5f5f4 75%)`,
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        <img
          src={src}
          alt={fileName}
          className={inline ? "max-h-full max-w-full rounded object-contain shadow-lg" : "max-h-[70vh] max-w-full rounded object-contain shadow-lg"}
        />
      </div>

      {/* Status bar footer */}
      <div className="flex items-center justify-between border-t border-stone-100 bg-gradient-to-b from-stone-50 to-stone-100/50 px-4 py-1.5">
        <span className="text-[10px] text-stone-400 truncate">{filePath}</span>
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
