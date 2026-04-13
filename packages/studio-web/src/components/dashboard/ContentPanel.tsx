import { useEffect, useMemo, useRef, useState } from "react";

import {
  createThreadDocument,
  fetchThreadDocuments,
  updateThreadDocument,
} from "../../lib/api";
import {
  assembleReply,
  countChars,
  joinReplies,
  parseReply,
  splitReplies,
  THREADS_REPLY_LIMIT,
} from "../../lib/threads-reply-split";
import type {
  ThreadDocument,
  ThreadDocumentStatus,
} from "../../types/thread-document";

const STATUS_META: Record<ThreadDocumentStatus, { label: string; accent: string }> = {
  draft: { label: "Draft", accent: "#94a3b8" },
  approved: { label: "Approved", accent: "#f59e0b" },
  posted: { label: "Posted", accent: "#0ea5e9" },
};

const STATUS_CYCLE: ThreadDocumentStatus[] = ["draft", "approved", "posted"];

type EditingField = "title" | null;
type SavingField = EditingField | "body" | "status";

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "미지정";
  }

  return date.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusPillStyle(status: ThreadDocumentStatus) {
  const accent = STATUS_META[status].accent;
  return {
    background: `color-mix(in srgb, ${accent} 18%, transparent)`,
    border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
    color: accent,
  } as const;
}

interface ContentPanelProps {
  activeProjectId?: string | null;
}

export function ContentPanel({ activeProjectId: _activeProjectId }: ContentPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [items, setItems] = useState<ThreadDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingField, setSavingField] = useState<SavingField>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [pendingEditField, setPendingEditField] = useState<EditingField>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<string[]>([""]);
  const [editingReplyIndex, setEditingReplyIndex] = useState<number | null>(null);
  const [activeBodyDraft, setActiveBodyDraft] = useState<string>("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => right.updated.localeCompare(left.updated)),
    [items],
  );

  const selectedItem = useMemo(
    () => sortedItems.find((item) => item.id === selectedId) ?? null,
    [selectedId, sortedItems],
  );

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await fetchThreadDocuments();
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "스레드 문서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  useEffect(() => {
    if (sortedItems.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !sortedItems.some((item) => item.id === selectedId)) {
      setSelectedId(sortedItems[0].id);
    }
  }, [selectedId, sortedItems]);

  useEffect(() => {
    if (!selectedItem) {
      setTitleDraft("");
      setReplyDrafts([""]);
      setEditingField(null);
      setEditingReplyIndex(null);
      return;
    }

    setTitleDraft(selectedItem.title);
    setReplyDrafts(splitReplies(selectedItem.body));
    setEditingReplyIndex(null);

    if (pendingEditField) {
      setEditingField(pendingEditField);
      setPendingEditField(null);
    } else {
      setEditingField(null);
    }
  }, [pendingEditField, selectedItem?.id, selectedItem?.updated]);

  useEffect(() => {
    if (editingField === "title") {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [editingField]);

  useEffect(() => {
    if (editingReplyIndex !== null) {
      const node = replyRef.current;
      if (node) {
        node.focus();
        const cursor = node.value.length;
        node.setSelectionRange(cursor, cursor);
      }
    }
  }, [editingReplyIndex]);

  const replaceItem = (updated: ThreadDocument) => {
    setItems((current) => {
      const exists = current.some((item) => item.id === updated.id);
      if (!exists) {
        return [updated, ...current];
      }
      return current.map((item) => (item.id === updated.id ? updated : item));
    });
    setSelectedId(updated.id);
  };

  const cancelTitleEdit = () => {
    if (selectedItem) {
      setTitleDraft(selectedItem.title);
    }
    setEditingField((current) => (current === "title" ? null : current));
  };

  const saveTitle = async () => {
    if (!selectedItem) {
      setEditingField(null);
      return;
    }

    const nextValue = titleDraft.trim() || "새 스레드";

    if (nextValue === selectedItem.title) {
      setTitleDraft(selectedItem.title);
      setEditingField((current) => (current === "title" ? null : current));
      return;
    }

    setSavingField("title");
    try {
      const updated = await updateThreadDocument(selectedItem.id, { title: nextValue });
      replaceItem(updated);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "스레드 저장에 실패했습니다.");
    } finally {
      setSavingField((current) => (current === "title" ? null : current));
      setEditingField((current) => (current === "title" ? null : current));
    }
  };

  const saveReplies = async (nextDrafts: string[]) => {
    if (!selectedItem) return;
    const nextBody = joinReplies(nextDrafts).trim();
    if (nextBody === selectedItem.body) return;

    setSavingField("body");
    try {
      const updated = await updateThreadDocument(selectedItem.id, { body: nextBody });
      replaceItem(updated);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "스레드 저장에 실패했습니다.");
    } finally {
      setSavingField((current) => (current === "body" ? null : current));
    }
  };

  const startEditingReply = (index: number) => {
    const raw = replyDrafts[index] ?? "";
    setActiveBodyDraft(parseReply(raw).body);
    setEditingReplyIndex(index);
  };

  const handleReplyBlur = async () => {
    if (editingReplyIndex === null) return;
    const index = editingReplyIndex;
    const originalAttachments = parseReply(replyDrafts[index] ?? "").attachments;
    const nextRaw = assembleReply({ body: activeBodyDraft, attachments: originalAttachments });
    const next = replyDrafts.map((draft, i) => (i === index ? nextRaw : draft));
    setReplyDrafts(next);
    setEditingReplyIndex(null);
    await saveReplies(next);
  };

  const handleReplyCancel = () => {
    setEditingReplyIndex(null);
  };

  const handleAddReply = () => {
    setReplyDrafts((current) => {
      const next = [...current, ""];
      setActiveBodyDraft("");
      setEditingReplyIndex(next.length - 1);
      return next;
    });
  };

  const handleDeleteReply = async (index: number) => {
    const next = replyDrafts.filter((_, i) => i !== index);
    const normalized = next.length === 0 ? [""] : next;
    setReplyDrafts(normalized);
    setEditingReplyIndex(null);
    await saveReplies(normalized);
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const created = await createThreadDocument({
        title: "새 스레드",
        body: "",
        status: "draft",
      });
      replaceItem(created);
      setPendingEditField("title");
      setCollapsed(false);
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "새 스레드를 만들지 못했습니다.");
    } finally {
      setCreating(false);
    }
  };

  const cycleStatus = async () => {
    if (!selectedItem || savingField) return;
    const currentIndex = STATUS_CYCLE.indexOf(selectedItem.status);
    const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];
    setSavingField("status");
    try {
      const updated = await updateThreadDocument(selectedItem.id, { status: nextStatus });
      replaceItem(updated);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "상태 변경에 실패했습니다.");
    } finally {
      setSavingField((current) => (current === "status" ? null : current));
    }
  };

  return (
    <section
      aria-labelledby="content-panel-title"
      className="overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
      style={{
        background: "var(--panel-bg)",
        borderColor: "var(--panel-border)",
        color: "var(--t-primary)",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
        onMouseEnter={(event) => { event.currentTarget.style.background = "var(--panel-hover)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
      >
        <div>
          <span
            id="content-panel-title"
            className="text-[12px] font-bold uppercase tracking-[0.18em]"
            style={{ color: "var(--t-muted)" }}
          >
            Threads Desk ({sortedItems.length})
          </span>
          <p className="mt-1 text-[14px]" style={{ color: "var(--t-secondary)" }}>
            Vault 파일을 바로 고르는 목록과, 클릭 즉시 수정되는 상세 편집 화면
          </p>
        </div>
        <span className="text-[12px]" style={{ color: "var(--t-faint)" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed ? (
        <div className="border-t" style={{ borderColor: "var(--panel-border)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="text-[13px]" style={{ color: "var(--t-secondary)" }}>
              {loading ? "스레드 목록을 불러오는 중" : `Vault threads ${sortedItems.length}`}
            </div>
            <button
              type="button"
              data-panel-no-drag="true"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="rounded-xl px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--color-kuma-orange)" }}
            >
              {creating ? "생성 중" : "새 초안 작성"}
            </button>
          </div>

          {error ? (
            <div
              className="mx-4 mb-3 rounded-2xl border px-4 py-3 text-[13px]"
              style={{
                borderColor: "var(--toast-error-border)",
                background: "var(--toast-error-bg)",
                color: "var(--toast-error-text)",
              }}
            >
              {error}
            </div>
          ) : null}

          <div className="grid min-h-[34rem] grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
            <aside
              className="flex min-h-0 flex-col border-r"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <div
                className="border-b px-4 py-3"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <p className="text-[13px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--t-faint)" }}>
                  Thread List
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-4 py-8 text-center text-[14px]" style={{ color: "var(--t-muted)" }}>
                    목록을 읽는 중입니다.
                  </div>
                ) : sortedItems.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[14px]" style={{ color: "var(--t-muted)" }}>
                    아직 저장된 스레드가 없습니다.
                  </div>
                ) : (
                  sortedItems.map((item) => {
                    const selected = item.id === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-panel-no-drag="true"
                        onClick={() => setSelectedId(item.id)}
                        aria-current={selected ? "true" : undefined}
                        className="block w-full border-b px-4 py-3 text-left transition-colors last:border-b-0"
                        style={{
                          borderColor: "var(--card-border)",
                          background: selected ? "color-mix(in srgb, var(--color-kuma-orange) 14%, transparent)" : "transparent",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold" style={statusPillStyle(item.status)}>
                            {STATUS_META[item.status].label}
                          </span>
                          <p className="truncate text-[15px] font-semibold leading-6">
                            {item.title || item.fileName}
                          </p>
                        </div>
                        <p className="mt-1 truncate text-[12px]" style={{ color: "var(--t-faint)" }}>
                          {formatDateTime(item.updated)}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <div className="min-w-0">
              {!selectedItem ? (
                <div className="flex h-full min-h-[34rem] flex-col items-center justify-center px-6 py-12 text-center">
                  <p className="text-[19px] font-semibold">선택된 스레드가 없습니다.</p>
                  <p className="mt-3 max-w-md text-[15px] leading-6" style={{ color: "var(--t-secondary)" }}>
                    왼쪽 목록에서 파일을 고르거나 새 초안을 만들어 Vault 기반 스레드 초안을 시작하세요.
                  </p>
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <div
                    className="flex items-start justify-between gap-4 border-b px-5 py-4"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--t-faint)" }}>
                        Detail
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-panel-no-drag="true"
                          onClick={() => void cycleStatus()}
                          disabled={savingField === "status"}
                          className="rounded-full px-2 py-0.5 text-[13px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                          style={{ ...statusPillStyle(selectedItem.status), cursor: "pointer" }}
                          title="클릭하여 상태 변경"
                        >
                          {savingField === "status" ? "..." : STATUS_META[selectedItem.status].label}
                        </button>
                        <span className="text-[13px]" style={{ color: "var(--t-secondary)" }}>
                          {selectedItem.fileName}
                        </span>
                        <span className="text-[13px]" style={{ color: "var(--t-faint)" }}>
                          수정 {formatDateTime(selectedItem.updated)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[13px]" style={{ color: "var(--t-faint)" }}>
                      {savingField ? "저장 중" : "텍스트 클릭 후 수정"}
                    </span>
                  </div>

                  <div className="grid gap-5 px-5 py-5">
                    <div>
                      <p className="text-[13px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--t-faint)" }}>
                        Title
                      </p>
                      {editingField === "title" ? (
                        <textarea
                          ref={titleRef}
                          rows={2}
                          value={titleDraft}
                          onChange={(event) => setTitleDraft(event.target.value)}
                          onBlur={() => void saveTitle()}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelTitleEdit();
                            }
                            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                              event.preventDefault();
                              void saveTitle();
                            }
                          }}
                          className="mt-2 w-full resize-none rounded-2xl border px-4 py-3 text-[17px] font-semibold"
                          style={{
                            borderColor: "var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--t-primary)",
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          data-panel-no-drag="true"
                          onClick={() => setEditingField("title")}
                          className="mt-2 block w-full rounded-2xl border px-4 py-3 text-left text-[17px] font-semibold transition-colors"
                          style={{
                            borderColor: "var(--card-border)",
                            background: "var(--card-bg)",
                            color: "var(--t-primary)",
                          }}
                        >
                          {selectedItem.title || "제목을 입력하세요"}
                        </button>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[13px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--t-faint)" }}>
                          Replies ({replyDrafts.length})
                        </p>
                        <span className="text-[13px]" style={{ color: "var(--t-faint)" }}>
                          총 {replyDrafts.reduce((sum, r) => sum + countChars(parseReply(r).body), 0)}자 · 댓글당 {THREADS_REPLY_LIMIT}자 권장
                        </span>
                      </div>

                      <div className="mt-3 flex flex-col gap-3">
                        {replyDrafts.map((draft, index) => {
                          const parsed = parseReply(draft);
                          const isEditing = editingReplyIndex === index;
                          const displayBody = isEditing ? activeBodyDraft : parsed.body;
                          const chars = countChars(displayBody);
                          const overLimit = chars > THREADS_REPLY_LIMIT;
                          const isLast = index === replyDrafts.length - 1;
                          const attachments = parsed.attachments;
                          return (
                            <div key={index} className="relative">
                              <div className="flex items-stretch gap-3">
                                <div className="flex w-6 flex-col items-center">
                                  <span
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                                    style={{
                                      background: "color-mix(in srgb, var(--color-kuma-orange) 18%, transparent)",
                                      color: "var(--color-kuma-orange)",
                                    }}
                                  >
                                    {index + 1}
                                  </span>
                                  {!isLast ? (
                                    <span
                                      className="mt-1 w-px flex-1"
                                      style={{ background: "var(--panel-border)" }}
                                    />
                                  ) : null}
                                </div>

                                <div className="min-w-0 flex-1">
                                  {isEditing ? (
                                    <textarea
                                      ref={replyRef}
                                      rows={Math.max(4, Math.min(16, activeBodyDraft.split("\n").length + 1))}
                                      value={activeBodyDraft}
                                      onChange={(event) => setActiveBodyDraft(event.target.value)}
                                      onBlur={() => void handleReplyBlur()}
                                      onKeyDown={(event) => {
                                        if (event.key === "Escape") {
                                          event.preventDefault();
                                          handleReplyCancel();
                                        }
                                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                          event.preventDefault();
                                          void handleReplyBlur();
                                        }
                                      }}
                                      className="w-full resize-none rounded-2xl border px-4 py-3 text-[15px] leading-7"
                                      style={{
                                        borderColor: "var(--input-border)",
                                        background: "var(--input-bg)",
                                        color: "var(--t-primary)",
                                      }}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      data-panel-no-drag="true"
                                      onClick={() => startEditingReply(index)}
                                      className="block w-full rounded-2xl border px-4 py-3 text-left text-[15px] leading-7 transition-colors"
                                      style={{
                                        borderColor: "var(--card-border)",
                                        background: "var(--card-bg)",
                                        color: displayBody ? "var(--t-primary)" : "var(--t-secondary)",
                                        whiteSpace: "pre-wrap",
                                      }}
                                    >
                                      {displayBody || "댓글 내용을 입력하세요."}
                                    </button>
                                  )}

                                  {attachments.length > 0 ? (
                                    <div className="mt-2 flex flex-col gap-2">
                                      {attachments.map((att, attIndex) => (
                                        <div
                                          key={attIndex}
                                          className="rounded-xl border border-dashed px-3 py-2"
                                          style={{
                                            borderColor: "color-mix(in srgb, var(--color-kuma-orange) 35%, var(--panel-border))",
                                            background: "color-mix(in srgb, var(--color-kuma-orange) 6%, transparent)",
                                          }}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-kuma-orange)" }}>
                                              📎 텍스트 첨부 {attIndex + 1}
                                              {att.info ? ` · ${att.info}` : ""}
                                            </span>
                                            <span className="text-[11px]" style={{ color: "var(--t-faint)" }}>
                                              첨부 {countChars(att.content)}자
                                            </span>
                                          </div>
                                          <pre
                                            className="mt-1.5 max-h-48 overflow-auto text-[12px] leading-5"
                                            style={{
                                              color: "var(--t-secondary)",
                                              whiteSpace: "pre-wrap",
                                              wordBreak: "break-word",
                                            }}
                                          >
{att.content}
                                          </pre>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}

                                  <div className="mt-1.5 flex items-center justify-between gap-3 text-[12px]">
                                    <span
                                      style={{
                                        color: overLimit ? "var(--toast-error-text)" : "var(--t-faint)",
                                        fontWeight: overLimit ? 700 : 400,
                                      }}
                                    >
                                      본문 {chars} / {THREADS_REPLY_LIMIT}자 {overLimit ? "· 한도 초과" : ""}
                                    </span>
                                    <button
                                      type="button"
                                      data-panel-no-drag="true"
                                      onClick={() => void handleDeleteReply(index)}
                                      disabled={savingField === "body" || (replyDrafts.length === 1 && !displayBody && attachments.length === 0)}
                                      className="rounded-full px-2 py-0.5 text-[12px] transition-colors disabled:opacity-40"
                                      style={{ color: "var(--t-faint)" }}
                                    >
                                      delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          data-panel-no-drag="true"
                          onClick={handleAddReply}
                          disabled={savingField === "body"}
                          className="mt-1 self-start rounded-xl border border-dashed px-3 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60"
                          style={{
                            borderColor: "var(--panel-border)",
                            color: "var(--t-secondary)",
                          }}
                        >
                          + 댓글 추가
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
