import { useEffect, useMemo, useRef, useState } from "react";

import {
  createThreadDocument,
  fetchThreadDocuments,
  updateThreadDocument,
} from "../../lib/api";
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

type EditingField = "title" | "body" | null;
type SavingField = EditingField | "status";

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
  const [bodyDraft, setBodyDraft] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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
      setBodyDraft("");
      setEditingField(null);
      return;
    }

    setTitleDraft(selectedItem.title);
    setBodyDraft(selectedItem.body);

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
      return;
    }

    if (editingField === "body") {
      bodyRef.current?.focus();
      const cursor = bodyDraft.length;
      bodyRef.current?.setSelectionRange(cursor, cursor);
    }
  }, [bodyDraft.length, editingField]);

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

  const cancelEdit = (field: Exclude<EditingField, null>) => {
    if (selectedItem) {
      if (field === "title") {
        setTitleDraft(selectedItem.title);
      } else {
        setBodyDraft(selectedItem.body);
      }
    }
    setEditingField((current) => (current === field ? null : current));
  };

  const saveField = async (field: Exclude<EditingField, null>) => {
    if (!selectedItem) {
      setEditingField(null);
      return;
    }

    const nextValue =
      field === "title"
        ? titleDraft.trim() || "새 스레드"
        : bodyDraft.trim();
    const currentValue = field === "title" ? selectedItem.title : selectedItem.body;

    if (nextValue === currentValue) {
      if (field === "title") {
        setTitleDraft(currentValue);
      } else {
        setBodyDraft(currentValue);
      }
      setEditingField((current) => (current === field ? null : current));
      return;
    }

    setSavingField(field);
    try {
      const updated = await updateThreadDocument(
        selectedItem.id,
        field === "title" ? { title: nextValue } : { body: nextValue },
      );
      replaceItem(updated);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "스레드 저장에 실패했습니다.");
    } finally {
      setSavingField((current) => (current === field ? null : current));
      setEditingField((current) => (current === field ? null : current));
    }
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

          <div className="grid min-h-[34rem] grid-cols-[minmax(0,1fr),minmax(0,4fr)]">
            <aside
              className="border-r px-3 py-3"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <div
                className="rounded-2xl border"
                style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
              >
                <div
                  className="border-b px-3 py-2"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <p className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--t-faint)" }}>
                    Thread List
                  </p>
                </div>
                <div className="max-h-[36rem] overflow-y-auto">
                  {loading ? (
                    <div className="px-3 py-8 text-center text-[13px]" style={{ color: "var(--t-muted)" }}>
                      목록을 읽는 중입니다.
                    </div>
                  ) : sortedItems.length === 0 ? (
                    <div className="px-3 py-8 text-center text-[13px]" style={{ color: "var(--t-muted)" }}>
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
                          className="block w-full border-b px-3 py-3 text-left transition-colors last:border-b-0"
                          style={{
                            borderColor: "var(--card-border)",
                            background: selected ? "color-mix(in srgb, var(--color-kuma-orange) 11%, transparent)" : "transparent",
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={statusPillStyle(item.status)}>
                              {STATUS_META[item.status].label}
                            </span>
                            <p className="truncate text-[14px] font-semibold leading-6">
                              {item.title || item.fileName}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </aside>

            <div>
              {!selectedItem ? (
                <div className="flex h-full min-h-[34rem] flex-col items-center justify-center px-6 py-12 text-center">
                  <p className="text-[18px] font-semibold">선택된 스레드가 없습니다.</p>
                  <p className="mt-3 max-w-md text-[14px] leading-6" style={{ color: "var(--t-secondary)" }}>
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
                      <p className="text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--t-faint)" }}>
                        Detail
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-panel-no-drag="true"
                          onClick={() => void cycleStatus()}
                          disabled={savingField === "status"}
                          className="rounded-full px-2 py-0.5 text-[12px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                          style={{ ...statusPillStyle(selectedItem.status), cursor: "pointer" }}
                          title="클릭하여 상태 변경"
                        >
                          {savingField === "status" ? "..." : STATUS_META[selectedItem.status].label}
                        </button>
                        <span className="text-[12px]" style={{ color: "var(--t-secondary)" }}>
                          {selectedItem.fileName}
                        </span>
                        <span className="text-[12px]" style={{ color: "var(--t-faint)" }}>
                          수정 {formatDateTime(selectedItem.updated)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[12px]" style={{ color: "var(--t-faint)" }}>
                      {savingField ? "저장 중" : "텍스트 클릭 후 수정"}
                    </span>
                  </div>

                  <div className="grid gap-5 px-5 py-5">
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--t-faint)" }}>
                        Title
                      </p>
                      {editingField === "title" ? (
                        <textarea
                          ref={titleRef}
                          rows={2}
                          value={titleDraft}
                          onChange={(event) => setTitleDraft(event.target.value)}
                          onBlur={() => void saveField("title")}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelEdit("title");
                            }
                            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                              event.preventDefault();
                              void saveField("title");
                            }
                          }}
                          className="mt-2 w-full resize-none rounded-2xl border px-4 py-3 text-[16px] font-semibold"
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
                          className="mt-2 block w-full rounded-2xl border px-4 py-3 text-left text-[16px] font-semibold transition-colors"
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
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--t-faint)" }}>
                          Body
                        </p>
                        <span className="text-[12px]" style={{ color: "var(--t-faint)" }}>
                          포커스를 벗어나면 저장됩니다
                        </span>
                      </div>

                      {editingField === "body" ? (
                        <textarea
                          ref={bodyRef}
                          rows={16}
                          value={bodyDraft}
                          onChange={(event) => setBodyDraft(event.target.value)}
                          onBlur={() => void saveField("body")}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelEdit("body");
                            }
                            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                              event.preventDefault();
                              void saveField("body");
                            }
                          }}
                          className="mt-2 w-full resize-none rounded-2xl border px-4 py-3 text-[14px] leading-6"
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
                          onClick={() => setEditingField("body")}
                          className="mt-2 block min-h-[20rem] w-full rounded-2xl border px-4 py-4 text-left text-[14px] leading-6 transition-colors"
                          style={{
                            borderColor: "var(--card-border)",
                            background: "var(--card-bg)",
                            color: selectedItem.body ? "var(--t-primary)" : "var(--t-secondary)",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {selectedItem.body || "본문을 입력하세요. 지라 인라인 편집처럼 클릭 후 바로 수정할 수 있습니다."}
                        </button>
                      )}
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
