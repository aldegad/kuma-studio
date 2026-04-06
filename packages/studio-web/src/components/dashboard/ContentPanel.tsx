import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { KUMA_TEAM } from "../../types/agent";
import {
  createContentItem,
  deleteContentItem,
  fetchContentItems,
  generateContentDrafts,
  updateContentItem,
  updateContentStatus,
} from "../../lib/api";
import type { ContentItem, ContentStatus, ContentType } from "../../types/content";

const STATUS_META: Record<ContentStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-stone-100 text-stone-600" },
  ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-700" },
  posted: { label: "Posted", tone: "bg-sky-100 text-sky-700" },
  hold: { label: "Hold", tone: "bg-amber-100 text-amber-700" },
};

const TYPE_LABEL: Record<ContentType, string> = {
  text: "글",
  image: "이미지",
  video: "영상",
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "미지정";
  }

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

function toDatetimeLocalValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function previewText(body: string) {
  const compact = body.replace(/\s+/gu, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
}

function emptyDraft(project: string) {
  return {
    project,
    type: "text" as ContentType,
    title: "",
    body: "",
    assignee: "",
    scheduledFor: "",
  };
}

interface ContentPanelProps {
  activeProjectId?: string | null;
}

export function ContentPanel({ activeProjectId }: ContentPanelProps) {
  const initialProject = activeProjectId ?? "kuma-studio";
  const assignableMembers = useMemo(
    () => KUMA_TEAM.filter((member) => member.nodeType !== "session"),
    [],
  );
  const assignableMemberById = useMemo(
    () => new Map(assignableMembers.map((member) => [member.id, member])),
    [assignableMembers],
  );
  const [collapsed, setCollapsed] = useState(true);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [updatingAssigneeId, setUpdatingAssigneeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => emptyDraft(initialProject));
  const [activeAssigneeFilter, setActiveAssigneeFilter] = useState<string>("all");

  const activeAssigneeQuery =
    activeAssigneeFilter === "all"
      ? undefined
      : activeAssigneeFilter === "unassigned"
        ? null
        : activeAssigneeFilter;

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await fetchContentItems(activeProjectId ?? undefined, activeAssigneeQuery);
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "콘텐츠를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, [activeProjectId, activeAssigneeFilter]);

  useEffect(() => {
    if (!editorOpen || editingId) {
      return;
    }
    setDraft((current) => ({ ...current, project: activeProjectId ?? current.project }));
  }, [activeProjectId, editorOpen, editingId]);

  const scheduledItems = useMemo(
    () =>
      items
        .filter((item) => item.scheduledFor && item.status !== "posted")
        .sort((left, right) => String(left.scheduledFor).localeCompare(String(right.scheduledFor))),
    [items],
  );

  const openNewEditor = () => {
    setEditingId(null);
    setDraft(emptyDraft(activeProjectId ?? "kuma-studio"));
    setEditorOpen(true);
  };

  const openEditEditor = (item: ContentItem) => {
    setEditingId(item.id);
    setDraft({
      project: item.project,
      type: item.type,
      title: item.title,
      body: item.body,
      assignee: item.assignee ?? "",
      scheduledFor: toDatetimeLocalValue(item.scheduledFor),
    });
    setEditorOpen(true);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    try {
      const payload = {
        project: draft.project,
        type: draft.type,
        title: draft.title,
        body: draft.body,
        assignee: draft.assignee || null,
        scheduledFor: draft.scheduledFor || null,
      };

      if (editingId) {
        await updateContentItem(editingId, payload);
      } else {
        await createContentItem(payload);
      }

      setEditorOpen(false);
      setEditingId(null);
      setDraft(emptyDraft(activeProjectId ?? "kuma-studio"));
      await loadItems();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "콘텐츠 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateContentDrafts(activeProjectId ?? "kuma-studio");
      await loadItems();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "초안 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const handleStatus = async (item: ContentItem, status: ContentStatus) => {
    try {
      await updateContentStatus(item.id, status, item.scheduledFor);
      await loadItems();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "상태 변경에 실패했습니다.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteContentItem(id);
      await loadItems();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "삭제에 실패했습니다.");
    }
  };

  const handleAssigneeChange = async (item: ContentItem, assignee: string | null) => {
    setUpdatingAssigneeId(item.id);
    try {
      await updateContentItem(item.id, { assignee });
      await loadItems();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "담당자 배정에 실패했습니다.");
    } finally {
      setUpdatingAssigneeId(null);
    }
  };

  return (
    <section
      aria-labelledby="content-panel-title"
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
          id="content-panel-title"
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "var(--t-muted)" }}
        >
          Threads Content ({items.length})
        </span>
        <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
      <div className="space-y-3 px-3 pb-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            data-panel-no-drag="true"
            onClick={() => void handleGenerate()}
            className="rounded-lg px-2.5 py-1 text-[10px] font-semibold"
            style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
          >
            {generating ? "생성 중" : "자동 생성"}
          </button>
          <button
            type="button"
            data-panel-no-drag="true"
            onClick={openNewEditor}
            className="rounded-lg bg-[var(--color-kuma-orange)] px-2.5 py-1 text-[10px] font-semibold text-white"
          >
            새 카드
          </button>
        </div>
        {error ? (
          <div
            className="rounded-xl border px-3 py-2 text-[11px]"
            style={{ borderColor: "var(--toast-error-border)", background: "var(--toast-error-bg)", color: "var(--toast-error-text)" }}
          >
            {error}
          </div>
        ) : null}

        {editorOpen ? (
          <form
            onSubmit={handleSave}
            className="space-y-2 rounded-xl border p-3"
            style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
            data-panel-no-drag="true"
          >
            <div className="grid grid-cols-2 gap-2">
              <input
                value={draft.project}
                onChange={(event) => setDraft((current) => ({ ...current, project: event.target.value }))}
                placeholder="project"
                className="rounded-lg border px-2 py-1.5 text-[11px]"
                style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
              />
              <select
                value={draft.type}
                onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as ContentType }))}
                className="rounded-lg border px-2 py-1.5 text-[11px]"
                style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
              >
                <option value="text">글</option>
                <option value="image">이미지</option>
                <option value="video">영상</option>
              </select>
            </div>
            <select
              value={draft.assignee}
              onChange={(event) => setDraft((current) => ({ ...current, assignee: event.target.value }))}
              className="w-full rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
            >
              <option value="">미배정</option>
              {assignableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.emoji ?? ""} {member.nameKo}
                </option>
              ))}
            </select>
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="제목"
              className="w-full rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
            />
            <textarea
              value={draft.body}
              onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
              rows={5}
              placeholder="본문"
              className="w-full resize-none rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
            />
            <input
              type="datetime-local"
              value={draft.scheduledFor}
              onChange={(event) => setDraft((current) => ({ ...current, scheduledFor: event.target.value }))}
              className="w-full rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-panel-no-drag="true"
                onClick={() => setEditorOpen(false)}
                className="rounded-lg px-2.5 py-1 text-[10px]"
                style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
              >
                취소
              </button>
              <button
                type="submit"
                data-panel-no-drag="true"
                disabled={saving}
                className="rounded-lg bg-[var(--color-kuma-orange)] px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
              >
                {saving ? "저장 중" : editingId ? "수정 저장" : "카드 생성"}
              </button>
            </div>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-1.5" data-panel-no-drag="true">
          <button
            type="button"
            onClick={() => setActiveAssigneeFilter("all")}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${activeAssigneeFilter === "all" ? "bg-[var(--color-kuma-orange)] text-white" : ""}`}
            style={activeAssigneeFilter !== "all" ? { background: "var(--btn-ghost-bg)", color: "var(--t-secondary)" } : undefined}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setActiveAssigneeFilter("unassigned")}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${activeAssigneeFilter === "unassigned" ? "bg-[var(--color-kuma-orange)] text-white" : ""}`}
            style={activeAssigneeFilter !== "unassigned" ? { background: "var(--btn-ghost-bg)", color: "var(--t-secondary)" } : undefined}
          >
            미배정
          </button>
          {assignableMembers.map((member) => (
            <button
              key={`assignee-filter-${member.id}`}
              type="button"
              onClick={() => setActiveAssigneeFilter(member.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${activeAssigneeFilter === member.id ? "bg-[var(--color-kuma-orange)] text-white" : ""}`}
              style={activeAssigneeFilter !== member.id ? { background: "var(--btn-ghost-bg)", color: "var(--t-secondary)" } : undefined}
            >
              {member.emoji} {member.nameKo}
            </button>
          ))}
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          {loading ? (
            <p
              className="col-span-full rounded-xl border px-3 py-6 text-center text-[11px]"
              style={{ borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-muted)" }}
            >
              콘텐츠를 불러오는 중입니다.
            </p>
          ) : items.length === 0 ? (
            <p
              className="col-span-full rounded-xl border px-3 py-6 text-center text-[11px]"
              style={{ borderColor: "var(--card-border)", background: "var(--card-bg)", color: "var(--t-muted)" }}
            >
              아직 콘텐츠 카드가 없습니다. 자동 생성 또는 수동 작성으로 시작해보세요.
            </p>
          ) : (
            items.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border p-3"
                style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_META[item.status].tone}`}>
                        {STATUS_META[item.status].label}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px]"
                        style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                      >
                        {TYPE_LABEL[item.type]}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
                        {item.project}
                      </span>
                    </div>
                    <h4 className="mt-2 text-[13px] font-semibold leading-snug">{item.title}</h4>
                  </div>
                  <button
                    type="button"
                    data-panel-no-drag="true"
                    onClick={() => void handleDelete(item.id)}
                    className="rounded-md px-1.5 py-1 text-[10px] transition-colors"
                    style={{ color: "var(--danger-text)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--danger-hover-bg)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    삭제
                  </button>
                </div>

                <p className="mt-2 text-[11px] leading-5" style={{ color: "var(--t-secondary)" }}>
                  {previewText(item.body)}
                </p>

                <div
                  className="mt-3 flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[10px]"
                  style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                >
                  <span className="truncate">
                    담당자:{" "}
                    {item.assignee
                      ? `${assignableMemberById.get(item.assignee)?.emoji ?? ""} ${assignableMemberById.get(item.assignee)?.nameKo ?? item.assignee}`
                      : "미배정"}
                  </span>
                  <select
                    value={item.assignee ?? ""}
                    disabled={updatingAssigneeId === item.id}
                    onChange={(event) => void handleAssigneeChange(item, event.target.value || null)}
                    className="max-w-[10rem] rounded-md border px-1.5 py-1 text-[10px]"
                    style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
                  >
                    <option value="">미배정</option>
                    {assignableMembers.map((member) => (
                      <option key={`card-assignee-${item.id}-${member.id}`} value={member.id}>
                        {member.nameKo}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  className="mt-3 rounded-xl px-2.5 py-2 text-[10px]"
                  style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                >
                  예약: {formatDateTime(item.scheduledFor)}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5" data-panel-no-drag="true">
                  <button
                    type="button"
                    onClick={() => void handleStatus(item, "ready")}
                    className="rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white"
                  >
                    체크
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStatus(item, "posted")}
                    className="rounded-lg bg-sky-500 px-2 py-1 text-[10px] font-semibold text-white"
                  >
                    올리기
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStatus(item, "hold")}
                    className="rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-semibold text-white"
                  >
                    홀드
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditEditor(item)}
                    className="rounded-lg px-2 py-1 text-[10px] font-semibold"
                    style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
                  >
                    편집
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div
          className="rounded-2xl border p-3"
          style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
        >
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-semibold">예약 타임라인</h4>
            <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>{scheduledItems.length}건</span>
          </div>
          <div className="mt-3 space-y-2">
            {scheduledItems.length === 0 ? (
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                예약된 콘텐츠가 없습니다.
              </p>
            ) : (
              scheduledItems.map((item) => (
                <div
                  key={`timeline-${item.id}`}
                  className="rounded-xl px-3 py-2"
                  style={{ background: "var(--badge-bg)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium">
                      {item.title}
                      {item.assignee
                        ? ` · ${assignableMemberById.get(item.assignee)?.emoji ?? ""} ${assignableMemberById.get(item.assignee)?.nameKo ?? item.assignee}`
                        : " · 미배정"}
                    </span>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--t-faint)" }}>
                      {formatDateTime(item.scheduledFor)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      )}
    </section>
  );
}
