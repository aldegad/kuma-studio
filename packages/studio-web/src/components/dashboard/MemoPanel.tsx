import { useState } from "react";
import { useMemoStore } from "../../stores/use-memo-store";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MemoPanel() {
  const { memos, addMemo, deleteMemo } = useMemoStore();
  const [collapsed, setCollapsed] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  /* ── form state ── */
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [imageUrls, setImageUrls] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) return;

    const images = imageUrls
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    addMemo({ title: title.trim(), text: text.trim() || undefined, images });
    setTitle("");
    setText("");
    setImageUrls("");
    setShowForm(false);
  };

  return (
    <section
      aria-labelledby="memo-panel-title"
      className="overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
      style={{ background: "var(--panel-bg)", borderColor: "var(--panel-border)", color: "var(--t-primary)" }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
        style={{ ["--tw-bg-opacity" as string]: 1 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span
          id="memo-panel-title"
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "var(--t-muted)" }}
        >
          📋 메모 ({memos.length})
        </span>
        <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {/* ── add button / form ── */}
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full text-[10px] py-1.5 rounded-lg border border-dashed transition-colors"
              style={{ borderColor: "var(--input-border)", color: "var(--t-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              + 메모 추가
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-1.5">
              <input
                type="text"
                placeholder="제목"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-[11px] px-2 py-1 rounded-md border outline-none"
                style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
              />
              <textarea
                placeholder="내용 (선택)"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                className="w-full text-[11px] px-2 py-1 rounded-md border outline-none resize-none"
                style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
              />
              <input
                type="text"
                placeholder="이미지 URL (쉼표 구분)"
                value={imageUrls}
                onChange={(e) => setImageUrls(e.target.value)}
                className="w-full text-[11px] px-2 py-1 rounded-md border outline-none"
                style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  className="flex-1 text-[10px] py-1 rounded-md font-medium transition-colors"
                  style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--btn-solid-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--btn-solid-bg)"; }}
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 text-[10px] py-1 rounded-md transition-colors"
                  style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--btn-ghost-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--btn-ghost-bg)"; }}
                >
                  취소
                </button>
              </div>
            </form>
          )}

          {/* ── memo cards ── */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {memos.length === 0 ? (
              <p
                className="text-[10px] text-center py-2"
                style={{ color: "var(--t-faint)" }}
              >
                저장된 메모가 없습니다.
              </p>
            ) : (
              memos.map((memo) => (
                <div
                  key={memo.id}
                  className="rounded-lg border p-2 space-y-1.5"
                  style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
                >
                  {/* title row */}
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[11px] font-semibold leading-tight truncate"
                        style={{ color: "var(--t-secondary)" }}
                      >
                        {memo.title}
                      </p>
                      <p
                        className="text-[9px]"
                        style={{ color: "var(--t-faint)" }}
                      >
                        {formatDate(memo.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteMemo(memo.id)}
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded transition-colors"
                      style={{ color: "var(--danger-text)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--danger-hover-bg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>

                  {/* text */}
                  {memo.text && (
                    <p
                      className="text-[10px] leading-snug whitespace-pre-wrap"
                      style={{ color: "var(--t-secondary)" }}
                    >
                      {memo.text}
                    </p>
                  )}

                  {/* images */}
                  {memo.images.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {memo.images.map((url) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setLightboxUrl(url)}
                          className="rounded-md overflow-hidden border border-transparent hover:border-current transition-colors"
                        >
                          <img
                            src={url}
                            alt=""
                            className="w-12 h-12 object-cover rounded-md"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── lightbox modal ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setLightboxUrl(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="이미지 확대 보기"
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-[90vw] max-h-[85vh] rounded-xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
