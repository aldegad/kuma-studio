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

export function MemoPanel({ isNight }: { isNight?: boolean }) {
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

  const night = !!isNight;

  return (
    <section
      aria-labelledby="memo-panel-title"
      className={`overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md ${
        night
          ? "border-indigo-800/40 bg-indigo-950/70 text-indigo-100"
          : "border-white/50 bg-white/75 text-stone-800"
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-stone-50/30"
      >
        <span
          id="memo-panel-title"
          className={`text-[10px] font-bold uppercase tracking-wider ${
            night ? "text-indigo-400" : "text-stone-500"
          }`}
        >
          📋 메모 ({memos.length})
        </span>
        <span className={`text-[10px] ${night ? "text-indigo-500" : "text-stone-400"}`}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {/* ── add button / form ── */}
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className={`w-full text-[10px] py-1.5 rounded-lg border border-dashed transition-colors ${
                night
                  ? "border-indigo-700 text-indigo-400 hover:bg-indigo-900/50"
                  : "border-stone-300 text-stone-500 hover:bg-stone-100"
              }`}
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
                className={`w-full text-[11px] px-2 py-1 rounded-md border outline-none ${
                  night
                    ? "bg-indigo-900/60 border-indigo-700 text-indigo-100 placeholder:text-indigo-500"
                    : "bg-white border-stone-300 text-stone-800 placeholder:text-stone-400"
                }`}
              />
              <textarea
                placeholder="내용 (선택)"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                className={`w-full text-[11px] px-2 py-1 rounded-md border outline-none resize-none ${
                  night
                    ? "bg-indigo-900/60 border-indigo-700 text-indigo-100 placeholder:text-indigo-500"
                    : "bg-white border-stone-300 text-stone-800 placeholder:text-stone-400"
                }`}
              />
              <input
                type="text"
                placeholder="이미지 URL (쉼표 구분)"
                value={imageUrls}
                onChange={(e) => setImageUrls(e.target.value)}
                className={`w-full text-[11px] px-2 py-1 rounded-md border outline-none ${
                  night
                    ? "bg-indigo-900/60 border-indigo-700 text-indigo-100 placeholder:text-indigo-500"
                    : "bg-white border-stone-300 text-stone-800 placeholder:text-stone-400"
                }`}
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  className={`flex-1 text-[10px] py-1 rounded-md font-medium transition-colors ${
                    night
                      ? "bg-indigo-700 text-indigo-100 hover:bg-indigo-600"
                      : "bg-stone-700 text-white hover:bg-stone-600"
                  }`}
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className={`flex-1 text-[10px] py-1 rounded-md transition-colors ${
                    night
                      ? "bg-indigo-900 text-indigo-400 hover:bg-indigo-800"
                      : "bg-stone-200 text-stone-600 hover:bg-stone-300"
                  }`}
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
                className={`text-[10px] text-center py-2 ${
                  night ? "text-indigo-500" : "text-stone-400"
                }`}
              >
                저장된 메모가 없습니다.
              </p>
            ) : (
              memos.map((memo) => (
                <div
                  key={memo.id}
                  className={`rounded-lg border p-2 space-y-1.5 ${
                    night
                      ? "bg-indigo-900/40 border-indigo-800/40"
                      : "bg-white border-stone-200"
                  }`}
                >
                  {/* title row */}
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-[11px] font-semibold leading-tight truncate ${
                          night ? "text-indigo-200" : "text-stone-700"
                        }`}
                      >
                        {memo.title}
                      </p>
                      <p
                        className={`text-[9px] ${
                          night ? "text-indigo-500" : "text-stone-400"
                        }`}
                      >
                        {formatDate(memo.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteMemo(memo.id)}
                      className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        night
                          ? "text-red-400 hover:bg-red-900/40"
                          : "text-red-500 hover:bg-red-50"
                      }`}
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>

                  {/* text */}
                  {memo.text && (
                    <p
                      className={`text-[10px] leading-snug whitespace-pre-wrap ${
                        night ? "text-indigo-300" : "text-stone-600"
                      }`}
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
