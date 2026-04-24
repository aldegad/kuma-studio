import { useEffect, useRef, useState } from "react";
import { useMemoStore } from "../../stores/use-memo-store";
import { useWsStore } from "../../stores/use-ws-store";
import type { Memo } from "../../types/memo";
import { MarkdownBody } from "./MarkdownBody";
import { MemoImageLightbox } from "./MemoImageLightbox";
import { buildMemoImageFilename, copyMemoImageToClipboard, downloadMemoImage } from "./memo-image-actions";

interface FilesystemChangeEvent {
  type: "kuma-studio:event";
  event: {
    kind: "filesystem-change";
    changes: Array<{
      rootId: string;
      path: string;
      relativePath: string;
    }>;
  };
}

interface MemoLightboxImage {
  url: string;
  label: string;
  fileName: string;
}

const MEMO_PANEL_COLLAPSED_STORAGE_KEY = "kuma-studio.memo-panel.collapsed.v1";
const MEMO_PANEL_SELECTED_ID_STORAGE_KEY = "kuma-studio.memo-panel.selected-id.v1";

function loadBoolean(storageKey: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function saveBoolean(storageKey: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // storage unavailable; state still works in-memory
  }
}

function loadString(storageKey: string) {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(storageKey)?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveString(storageKey: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(storageKey, value);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // storage unavailable; state still works in-memory
  }
}

function isMemoChange(change: FilesystemChangeEvent["event"]["changes"][number]) {
  const candidates = [change.rootId, change.path, change.relativePath]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/\\/gu, "/"));

  return candidates.some((value) =>
    value === "memos" ||
    value.startsWith("memos/") ||
    value.includes("/memos/") ||
    value.includes("/vault/memos/"),
  );
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

function countMemoChars(memo: Memo) {
  return memo.text?.replace(/\s+/gu, "").length ?? 0;
}

function memoMetaLabel(memo: Memo) {
  const parts = [`${countMemoChars(memo).toLocaleString("ko-KR")}자`];
  if (memo.images.length > 0) {
    parts.push(`이미지 ${memo.images.length}`);
  }
  return parts.join(" · ");
}

export function MemoPanel() {
  const { memos, loadMemos, addMemo, deleteMemo, initialized, loading } = useMemoStore();
  const ws = useWsStore((state) => state.ws);
  const [collapsed, setCollapsed] = useState(() => loadBoolean(MEMO_PANEL_COLLAPSED_STORAGE_KEY, false));
  const [selectedId, setSelectedId] = useState<string | null>(() => loadString(MEMO_PANEL_SELECTED_ID_STORAGE_KEY));
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!initialized) loadMemos();
  }, [initialized, loadMemos]);

  useEffect(() => {
    if (!ws) return;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void loadMemos();
      }, 120);
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as FilesystemChangeEvent;
        if (payload.type !== "kuma-studio:event" || payload.event.kind !== "filesystem-change") {
          return;
        }

        if (payload.event.changes.some(isMemoChange)) {
          scheduleRefresh();
        }
      } catch {
        // ignore malformed websocket payloads
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      ws.removeEventListener("message", handleMessage);
    };
  }, [loadMemos, ws]);
  const [showForm, setShowForm] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<MemoLightboxImage | null>(null);
  const [lightboxMessage, setLightboxMessage] = useState<string | null>(null);
  const [lightboxBusyAction, setLightboxBusyAction] = useState<"download" | "copy" | null>(null);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [imageUrls, setImageUrls] = useState("");

  const selectedMemo = memos.find((memo) => memo.id === selectedId) ?? memos[0] ?? null;

  const selectMemo = (memoId: string | null) => {
    setSelectedId(memoId);
    saveString(MEMO_PANEL_SELECTED_ID_STORAGE_KEY, memoId);
  };

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      saveBoolean(MEMO_PANEL_COLLAPSED_STORAGE_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    if (memos.length === 0) {
      if (selectedId !== null) {
        selectMemo(null);
      }
      return;
    }

    if (!selectedId || !memos.some((memo) => memo.id === selectedId)) {
      selectMemo(memos[0].id);
    }
  }, [memos, selectedId]);

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
          onClick={toggleCollapsed}
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

            <div className="grid min-h-[30rem] overflow-hidden rounded-xl border md:grid-cols-[minmax(9.5rem,11rem)_minmax(0,1fr)]" style={{ borderColor: "var(--card-border)" }}>
              {loading && !initialized ? (
                <p className="col-span-full py-8 text-center text-[12px]" style={{ color: "var(--t-faint)" }}>
                  불러오는 중...
                </p>
              ) : memos.length === 0 ? (
                <p className="col-span-full py-8 text-center text-[12px]" style={{ color: "var(--t-faint)" }}>
                  저장된 메모가 없습니다.
                </p>
              ) : (
                <>
                  <aside
                    className="min-h-0 border-b md:border-b-0 md:border-r"
                    style={{ borderColor: "var(--card-border)", background: "color-mix(in srgb, var(--card-bg) 68%, transparent)" }}
                  >
                    <div className="border-b px-2.5 py-2" style={{ borderColor: "var(--card-border)" }}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-faint)" }}>
                        Memo List
                      </p>
                    </div>
                    <div className="max-h-48 overflow-y-auto md:max-h-[28rem]">
                      {memos.map((memo) => {
                        const selected = memo.id === selectedMemo?.id;
                        return (
                          <button
                            key={memo.id}
                            type="button"
                            data-panel-no-drag="true"
                            onClick={() => selectMemo(memo.id)}
                            className="block w-full border-b px-2.5 py-2.5 text-left transition-colors last:border-b-0"
                            style={{
                              borderColor: "var(--border-subtle)",
                              background: selected ? "color-mix(in srgb, var(--color-kuma-orange) 13%, transparent)" : "transparent",
                            }}
                            aria-current={selected ? "true" : undefined}
                          >
                            <p className="truncate text-[13px] font-semibold leading-5" style={{ color: "var(--t-primary)" }}>
                              {memo.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--t-faint)" }}>
                              <span>{formatDate(memo.createdAt)}</span>
                              <span>{memoMetaLabel(memo)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </aside>

                  <div className="min-w-0">
                    {!selectedMemo ? (
                      <div className="flex min-h-[24rem] items-center justify-center px-4 py-8 text-center">
                        <p className="text-[13px]" style={{ color: "var(--t-muted)" }}>
                          왼쪽 목록에서 메모를 선택하세요.
                        </p>
                      </div>
                    ) : (
                      <article className="max-h-[30rem] overflow-y-auto px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--card-border)" }}>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-faint)" }}>
                              Status
                            </p>
                            <h3 className="mt-1 text-[17px] font-bold leading-6" style={{ color: "var(--t-primary)" }}>
                              {selectedMemo.title}
                            </h3>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--input-bg)", color: "var(--t-secondary)" }}>
                                {formatDate(selectedMemo.createdAt)}
                              </span>
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--input-bg)", color: "var(--t-secondary)" }}>
                                {memoMetaLabel(selectedMemo)}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            data-panel-no-drag="true"
                            onClick={() => {
                              void deleteMemo(selectedMemo.id);
                            }}
                            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors"
                            style={{ color: "var(--danger-text)", background: "var(--btn-ghost-bg)" }}
                            title="삭제"
                          >
                            삭제
                          </button>
                        </div>

                        {selectedMemo.text ? (
                          <div className="mt-3">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-faint)" }}>
                              Markdown
                            </p>
                            <MarkdownBody content={selectedMemo.text} />
                          </div>
                        ) : null}

                        {selectedMemo.images.length > 0 && (
                          <div className="mt-4">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-faint)" }}>
                              Images ({selectedMemo.images.length})
                            </p>
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2">
                              {selectedMemo.images.map((url, index) => (
                                <button
                                  key={url}
                                  type="button"
                                  data-panel-no-drag="true"
                                  onClick={() => handleOpenLightbox(url, selectedMemo.title)}
                                  className="overflow-hidden rounded-lg border border-transparent transition-colors hover:border-current"
                                  aria-label={`${selectedMemo.title} 이미지 ${index + 1} 확대 보기`}
                                >
                                  <img
                                    src={url}
                                    alt=""
                                    className="h-20 w-full rounded-lg object-cover"
                                    loading="lazy"
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    )}
                  </div>
                </>
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
