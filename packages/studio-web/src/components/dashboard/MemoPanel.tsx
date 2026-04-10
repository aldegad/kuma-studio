import { useEffect, useState } from "react";
import { useMemoStore } from "../../stores/use-memo-store";
import { MemoImageLightbox } from "./MemoImageLightbox";
import { buildMemoImageFilename, copyMemoImageToClipboard, downloadMemoImage } from "./memo-image-actions";

interface MemoLightboxImage {
  url: string;
  label: string;
  fileName: string;
}

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
  const { memos, loadMemos, addMemo, deleteMemo, initialized, loading } = useMemoStore();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!initialized) loadMemos();
  }, [initialized, loadMemos]);
  const [showForm, setShowForm] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<MemoLightboxImage | null>(null);
  const [lightboxMessage, setLightboxMessage] = useState<string | null>(null);
  const [lightboxBusyAction, setLightboxBusyAction] = useState<"download" | "copy" | null>(null);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [imageUrls, setImageUrls] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const images = imageUrls
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    await addMemo({ title: title.trim(), text: text.trim() || undefined, images });
    setTitle("");
    setText("");
    setImageUrls("");
    setShowForm(false);
  };

  const closeLightbox = () => {
    setLightboxImage(null);
    setLightboxMessage(null);
    setLightboxBusyAction(null);
  };

  const handleOpenLightbox = (url: string, label: string) => {
    setLightboxImage({
      url,
      label,
      fileName: buildMemoImageFilename(url, label),
    });
    setLightboxMessage(null);
    setLightboxBusyAction(null);
  };

  const handleDownloadLightboxImage = async () => {
    if (!lightboxImage) {
      return;
    }

    setLightboxBusyAction("download");
    setLightboxMessage(null);

    try {
      const fileName = await downloadMemoImage(lightboxImage.url, lightboxImage.label);
      setLightboxMessage(`${fileName} 다운로드를 시작했습니다.`);
    } catch (error) {
      setLightboxMessage(error instanceof Error ? error.message : "메모 이미지 다운로드에 실패했습니다.");
    } finally {
      setLightboxBusyAction(null);
    }
  };

  const handleCopyLightboxImage = async () => {
    if (!lightboxImage) {
      return;
    }

    setLightboxBusyAction("copy");
    setLightboxMessage(null);

    try {
      await copyMemoImageToClipboard(lightboxImage.url);
      setLightboxMessage("이미지를 클립보드에 복사했습니다.");
    } catch (error) {
      setLightboxMessage(error instanceof Error ? error.message : "메모 이미지 복사에 실패했습니다.");
    } finally {
      setLightboxBusyAction(null);
    }
  };

  return (
    <>
      <section
        aria-labelledby="memo-panel-title"
        className="overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
        style={{ background: "var(--panel-bg)", borderColor: "var(--panel-border)", color: "var(--t-primary)" }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <span
            id="memo-panel-title"
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--t-muted)" }}
          >
            메모 ({memos.length})
          </span>
          <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
            {collapsed ? "▼" : "▲"}
          </span>
        </button>

        {!collapsed && (
          <div className="space-y-2 px-3 pb-3">
            {!showForm ? (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="w-full rounded-lg border border-dashed px-3 py-1.5 text-[10px] font-medium transition-colors"
                style={{ borderColor: "var(--input-border)", color: "var(--t-muted)" }}
              >
                + 메모 추가
              </button>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-1.5 rounded-xl border p-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                <input
                  type="text"
                  placeholder="제목"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-md border px-2 py-1.5 text-[11px] outline-none"
                  style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
                />
                <textarea
                  placeholder="내용 (선택)"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-md border px-2 py-1.5 text-[11px] outline-none"
                  style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
                />
                <input
                  type="text"
                  placeholder="이미지 URL (쉼표 구분)"
                  value={imageUrls}
                  onChange={(e) => setImageUrls(e.target.value)}
                  className="w-full rounded-md border px-2 py-1.5 text-[11px] outline-none"
                  style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--t-primary)" }}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors"
                    style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 rounded-md px-3 py-1.5 text-[10px] transition-colors"
                    style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
                  >
                    취소
                  </button>
                </div>
              </form>
            )}

            <div className="max-h-64 space-y-2 overflow-y-auto">
              {loading && !initialized ? (
                <p className="py-2 text-center text-[10px]" style={{ color: "var(--t-faint)" }}>
                  불러오는 중...
                </p>
              ) : memos.length === 0 ? (
                <p className="py-2 text-center text-[10px]" style={{ color: "var(--t-faint)" }}>
                  저장된 메모가 없습니다.
                </p>
              ) : (
                memos.map((memo) => (
                  <div
                    key={memo.id}
                    className="space-y-1.5 rounded-xl border p-2.5"
                    style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-semibold leading-tight" style={{ color: "var(--t-primary)" }}>
                          {memo.title}
                        </p>
                        <p className="text-[9px]" style={{ color: "var(--t-faint)" }}>
                          {formatDate(memo.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteMemo(memo.id);
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                        style={{ color: "var(--danger-text)" }}
                        title="삭제"
                      >
                        ✕
                      </button>
                    </div>

                    {memo.text && (
                      <p className="whitespace-pre-wrap text-[10px] leading-snug" style={{ color: "var(--t-secondary)" }}>
                        {memo.text}
                      </p>
                    )}

                    {memo.images.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {memo.images.map((url, index) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => handleOpenLightbox(url, memo.title)}
                            className="overflow-hidden rounded-md border border-transparent transition-colors hover:border-current"
                            aria-label={`${memo.title} 이미지 ${index + 1} 확대 보기`}
                          >
                            <img
                              src={url}
                              alt=""
                              className="h-12 w-12 rounded-md object-cover"
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
      </section>

      <MemoImageLightbox
        imageUrl={lightboxImage?.url ?? null}
        imageLabel={lightboxImage?.label ?? ""}
        fileName={lightboxImage?.fileName ?? ""}
        actionMessage={lightboxMessage}
        busyAction={lightboxBusyAction}
        onDownload={() => {
          void handleDownloadLightboxImage();
        }}
        onCopy={() => {
          void handleCopyLightboxImage();
        }}
        onClose={closeLightbox}
      />
    </>
  );
}
