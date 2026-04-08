import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useTeamConfigStore } from "../../stores/use-team-config-store";
import {
  createContentItem,
  deleteContentItem,
  fetchContentItems,
  generateContentPost,
  generateContentDrafts,
  startContentResearch,
  updateContentItem,
  updateContentStatus,
} from "../../lib/api";
import type { ContentItem, ContentPostStatus, ContentStatus, ContentThreadPost, ContentType, ThreadPostFormat } from "../../types/content";

const STATUS_META: Record<ContentStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-stone-100 text-stone-600" },
  ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-700" },
  posted: { label: "Posted", tone: "bg-sky-100 text-sky-700" },
  hold: { label: "Hold", tone: "bg-amber-100 text-amber-700" },
};

const TYPE_META: Record<ContentType, { label: string; tone: string }> = {
  text: { label: "글", tone: "var(--badge-bg)" },
  image: { label: "이미지", tone: "color-mix(in srgb, var(--color-kuma-orange) 14%, white)" },
  video: { label: "영상", tone: "color-mix(in srgb, #2563eb 14%, white)" },
  "research-result": { label: "연구결과", tone: "color-mix(in srgb, #fb923c 18%, white)" },
};

const POST_STATUS_META: Record<ContentPostStatus, { label: string; tone: string }> = {
  draft: { label: "Post Draft", tone: "bg-stone-100 text-stone-600" },
  preview: { label: "Preview", tone: "bg-violet-100 text-violet-700" },
  approved: { label: "Approved", tone: "bg-amber-100 text-amber-700" },
  ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-700" },
};

interface ThreadPostDraft {
  hook: string;
  body: string;
  cta: string;
  format: ThreadPostFormat;
}

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

function formatResearchScore(value: number | null) {
  return typeof value === "number" ? value.toFixed(2) : "--";
}

function toThreadPostDrafts(threadPosts: ContentThreadPost[]): ThreadPostDraft[] {
  if (!Array.isArray(threadPosts) || threadPosts.length === 0) {
    return [];
  }

  return threadPosts.map((post) => ({
    hook: post.hook,
    body: post.bodyLines.join("\n"),
    cta: post.cta,
    format: post.format,
  }));
}

function fromThreadPostDrafts(drafts: ThreadPostDraft[]): ContentThreadPost[] {
  return drafts
    .map((draft) => ({
      hook: draft.hook.trim(),
      bodyLines: draft.body.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 3),
      cta: draft.cta.trim(),
      format: draft.format,
    }))
    .filter((post) => post.hook || post.bodyLines.length > 0 || post.cta);
}

function formatThreadPostsForCopy(threadPosts: ContentThreadPost[]): string {
  return threadPosts
    .map((post) => [post.hook, ...post.bodyLines, post.cta].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
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

const CONTENT_PIPELINE_STEPS = ["수집", "초안", "포스트", "승인", "발행"] as const;
const RESEARCH_PIPELINE_STEPS = ["제안", "연구중", "보고완료"] as const;

function getContentStepIndex(item: ContentItem): number {
  if (item.status === "posted") return 4;
  if (item.postStatus === "approved" || item.postStatus === "ready") return 3;
  if (item.postStatus === "preview" || item.threadPosts.length > 0) return 2;
  if (item.body) return 1;
  return 0;
}

function getResearchStepIndex(item: ContentItem): number {
  if (item.type === "research-result") return 2;
  if (item.experimentId) return 1;
  return 0;
}

interface ContentPanelProps {
  activeProjectId?: string | null;
}

export function ContentPanel({ activeProjectId }: ContentPanelProps) {
  const initialProject = activeProjectId ?? "kuma-studio";
  const teamMembers = useTeamConfigStore((s) => s.members);
  const assignableMembers = useMemo(
    () => teamMembers.filter((member) => member.nodeType !== "session"),
    [teamMembers],
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
  const [previewOpenId, setPreviewOpenId] = useState<string | null>(null);
  const [threadPostDrafts, setThreadPostDrafts] = useState<Record<string, ThreadPostDraft[]>>({});
  const [postActionId, setPostActionId] = useState<string | null>(null);
  const [savingPreviewId, setSavingPreviewId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [researchActionId, setResearchActionId] = useState<string | null>(null);
  const [highlightedContentId, setHighlightedContentId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string } | undefined;
      if (!detail?.id) return;
      const found = items.find((item) => item.id === detail.id);
      if (!found) return;
      setCollapsed(false);
      setHighlightedContentId(detail.id);
      setTimeout(() => {
        sectionRef.current?.querySelector(`[data-content-id="${detail.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      setTimeout(() => setHighlightedContentId(null), 2500);
    };
    window.addEventListener("navigate-to-content", handler);
    return () => window.removeEventListener("navigate-to-content", handler);
  }, [items]);

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

  const researchSuggestionItems = useMemo(
    () => items.filter((item) => item.researchSuggestion && item.type !== "research-result"),
    [items],
  );

  const researchResultItems = useMemo(
    () => items.filter((item) => item.type === "research-result"),
    [items],
  );

  const regularItems = useMemo(
    () => items.filter((item) => !item.researchSuggestion && item.type !== "research-result"),
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

  const openPreview = (item: ContentItem) => {
    setPreviewOpenId((current) => (current === item.id ? null : item.id));
    setThreadPostDrafts((current) => (
      current[item.id]
        ? current
        : { ...current, [item.id]: toThreadPostDrafts(item.threadPosts) }
    ));
  };

  const handleGeneratePost = async (item: ContentItem) => {
    setPostActionId(item.id);
    try {
      const updated = await generateContentPost(item.id);
      setPreviewOpenId(item.id);
      setThreadPostDrafts((current) => ({ ...current, [item.id]: toThreadPostDrafts(updated.threadPosts) }));
      await loadItems();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "포스트 초안 생성에 실패했습니다.");
    } finally {
      setPostActionId(null);
    }
  };

  const handleThreadPostDraftChange = (
    itemId: string,
    index: number,
    key: keyof ThreadPostDraft,
    value: string,
  ) => {
    setThreadPostDrafts((current) => ({
      ...current,
      [itemId]: (current[itemId] ?? []).map((draftEntry, draftIndex) => (
        draftIndex === index
          ? { ...draftEntry, [key]: value }
          : draftEntry
      )),
    }));
  };

  const handleSavePreview = async (item: ContentItem) => {
    setSavingPreviewId(item.id);
    try {
      const updated = await updateContentItem(item.id, {
        threadPosts: fromThreadPostDrafts(threadPostDrafts[item.id] ?? []),
        postStatus: "preview",
      });
      setThreadPostDrafts((current) => ({ ...current, [item.id]: toThreadPostDrafts(updated.threadPosts) }));
      await loadItems();
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "포스트 초안 저장에 실패했습니다.");
    } finally {
      setSavingPreviewId(null);
    }
  };

  const handlePostStatusChange = async (item: ContentItem, postStatus: ContentPostStatus) => {
    setPostActionId(item.id);
    try {
      const updated = await updateContentItem(item.id, { postStatus });
      setThreadPostDrafts((current) => ({ ...current, [item.id]: toThreadPostDrafts(updated.threadPosts) }));
      await loadItems();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "포스트 상태 변경에 실패했습니다.");
    } finally {
      setPostActionId(null);
    }
  };

  const handleCopyPosts = async (item: ContentItem) => {
    setCopyingId(item.id);
    try {
      const currentThreadPosts = threadPostDrafts[item.id]?.length > 0
        ? fromThreadPostDrafts(threadPostDrafts[item.id])
        : item.threadPosts;
      const text = formatThreadPostsForCopy(currentThreadPosts);

      if (!text) {
        throw new Error("복사할 포스트 초안이 없습니다.");
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error("이 브라우저에서는 클립보드 복사가 지원되지 않습니다.");
      }

      await navigator.clipboard.writeText(text);

      if (threadPostDrafts[item.id]?.length > 0 || item.postStatus === "approved") {
        const updated = await updateContentItem(item.id, {
          threadPosts: currentThreadPosts,
          postStatus: item.postStatus === "approved" ? "ready" : item.postStatus,
        });
        setThreadPostDrafts((current) => ({ ...current, [item.id]: toThreadPostDrafts(updated.threadPosts) }));
        await loadItems();
      }
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "포스트 복사에 실패했습니다.");
    } finally {
      setCopyingId(null);
    }
  };

  const handleStartResearch = async (item: ContentItem) => {
    if (item.experimentId) {
      return;
    }

    setResearchActionId(item.id);
    try {
      await startContentResearch(item.id);
      await loadItems();
    } catch (researchError) {
      setError(researchError instanceof Error ? researchError.message : "연구 시작에 실패했습니다.");
    } finally {
      setResearchActionId(null);
    }
  };

  const renderContentCard = (item: ContentItem) => {
    const isResearchPipeline = item.researchSuggestion || item.type === "research-result";
    const pipelineSteps = isResearchPipeline ? RESEARCH_PIPELINE_STEPS : CONTENT_PIPELINE_STEPS;
    const currentStep = isResearchPipeline ? getResearchStepIndex(item) : getContentStepIndex(item);
    const isHighlighted = highlightedContentId === item.id;

    return (
    <article
      key={item.id}
      data-content-id={item.id}
      className="rounded-2xl border p-3 transition-all duration-500"
      style={{
        borderColor: isHighlighted ? "var(--color-kuma-orange)" : "var(--card-border)",
        background: isHighlighted ? "color-mix(in srgb, var(--color-kuma-orange) 8%, var(--card-bg))" : "var(--card-bg)",
        boxShadow: isHighlighted ? "0 0 12px rgba(234, 88, 12, 0.2)" : "none",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_META[item.status].tone}`}>
              {STATUS_META[item.status].label}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${POST_STATUS_META[item.postStatus].tone}`}>
              {POST_STATUS_META[item.postStatus].label}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{ background: TYPE_META[item.type].tone, color: "var(--badge-text)" }}
            >
              {TYPE_META[item.type].label}
            </span>
            {item.researchSuggestion ? (
              <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700">
                🔬 연구 제안
              </span>
            ) : null}
            {item.experimentId ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                실험 연결됨
              </span>
            ) : null}
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

      {item.researchSuggestion ? (
        <div
          className="mt-2 rounded-xl border px-2.5 py-2 text-[10px]"
          style={{ borderColor: "color-mix(in srgb, var(--color-kuma-orange) 30%, transparent)", background: "color-mix(in srgb, var(--color-kuma-orange) 10%, transparent)", color: "var(--t-secondary)" }}
        >
          연구 점수 {formatResearchScore(item.researchScore)}
          {item.researchBreakdown ? (
            <span style={{ color: "var(--t-faint)" }}>
              {" "}
              · N {formatResearchScore(item.researchBreakdown.novelty)}
              {" / "}F {formatResearchScore(item.researchBreakdown.feasibility)}
              {" / "}E {formatResearchScore(item.researchBreakdown.engagement)}
              {" / "}R {formatResearchScore(item.researchBreakdown.recency)}
            </span>
          ) : null}
        </div>
      ) : null}

      {item.sourceLinks.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-panel-no-drag="true">
          {item.sourceLinks.map((link, index) => (
            <a
              key={`${item.id}-source-${link}`}
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "var(--badge-bg)", color: "var(--color-kuma-orange)" }}
              title={link}
            >
              Source {index + 1}
            </a>
          ))}
        </div>
      ) : null}

      {previewOpenId === item.id ? (
        <div
          className="mt-3 space-y-3 rounded-2xl border p-3"
          style={{ borderColor: "var(--card-border)", background: "color-mix(in srgb, var(--card-bg) 82%, white 18%)" }}
          data-panel-no-drag="true"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h5 className="text-[11px] font-semibold">포스트 미리보기</h5>
              <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                hook → body → CTA 규칙으로 생성된 Threads 초안입니다.
              </p>
            </div>
            <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
              {item.threadPosts.length} posts
            </span>
          </div>

          {item.threadPosts.length === 0 && (threadPostDrafts[item.id] ?? []).length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
              아직 생성된 포스트 초안이 없습니다.
            </p>
          ) : (
            (threadPostDrafts[item.id] ?? toThreadPostDrafts(item.threadPosts)).map((post, index) => (
              <div
                key={`${item.id}-post-${index}`}
                className="space-y-2 rounded-2xl border p-3"
                style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold" style={{ color: "var(--t-muted)" }}>
                    Post {index + 1}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px]"
                    style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                  >
                    {post.format}
                  </span>
                </div>
                <textarea
                  value={post.hook}
                  onChange={(event) => handleThreadPostDraftChange(item.id, index, "hook", event.target.value)}
                  rows={2}
                  placeholder="hook"
                  className="w-full resize-none rounded-lg border px-2 py-1.5 text-[11px] font-semibold"
                  style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
                />
                <textarea
                  value={post.body}
                  onChange={(event) => handleThreadPostDraftChange(item.id, index, "body", event.target.value)}
                  rows={4}
                  placeholder="body lines"
                  className="w-full resize-none rounded-lg border px-2 py-1.5 text-[11px]"
                  style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
                />
                <textarea
                  value={post.cta}
                  onChange={(event) => handleThreadPostDraftChange(item.id, index, "cta", event.target.value)}
                  rows={2}
                  placeholder="CTA"
                  className="w-full resize-none rounded-lg border px-2 py-1.5 text-[11px]"
                  style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
                />

                <div
                  className="rounded-2xl border px-3 py-3"
                  style={{ borderColor: "var(--panel-border)", background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.08))" }}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-faint)" }}>
                    Threads Preview
                  </div>
                  <p className="mt-2 text-[12px] font-semibold leading-5">{post.hook}</p>
                  <div className="mt-2 space-y-1">
                    {post.body.split(/\r?\n/u).filter(Boolean).map((line, lineIndex) => (
                      <p key={`${item.id}-post-${index}-line-${lineIndex}`} className="text-[11px] leading-5" style={{ color: "var(--t-secondary)" }}>
                        {line}
                      </p>
                    ))}
                  </div>
                  {post.cta ? (
                    <p className="mt-2 text-[11px] font-medium" style={{ color: "var(--color-kuma-orange)" }}>
                      {post.cta}
                    </p>
                  ) : null}
                </div>
              </div>
            ))
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void handleSavePreview(item)}
              disabled={savingPreviewId === item.id}
              className="rounded-lg px-2 py-1 text-[10px] font-semibold"
              style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
            >
              {savingPreviewId === item.id ? "저장 중" : "초안 저장"}
            </button>
            <button
              type="button"
              onClick={() => void handlePostStatusChange(item, "approved")}
              disabled={postActionId === item.id}
              className="rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-semibold text-white"
            >
              승인
            </button>
            <button
              type="button"
              onClick={() => void handlePostStatusChange(item, "ready")}
              disabled={postActionId === item.id}
              className="rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white"
            >
              발행 준비
            </button>
            <button
              type="button"
              onClick={() => void handleCopyPosts(item)}
              disabled={copyingId === item.id}
              className="rounded-lg px-2 py-1 text-[10px] font-semibold"
              style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
            >
              {copyingId === item.id ? "복사 중" : "복사"}
            </button>
          </div>
        </div>
      ) : null}

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

      {/* Pipeline status flow indicator */}
      <div className="mt-2 flex items-center gap-0.5">
        {pipelineSteps.map((step, i) => (
          <div key={step} className="flex-1 text-center">
            <div
              className="h-[3px] rounded-full"
              style={{
                background: i <= currentStep ? "var(--color-kuma-orange)" : "var(--panel-border)",
                opacity: i <= currentStep ? 1 : 0.3,
                boxShadow: i === currentStep ? "0 0 4px var(--color-kuma-orange)" : "none",
              }}
            />
            <div
              className="mt-0.5 text-[7px] leading-none"
              style={{
                color: i <= currentStep ? "var(--color-kuma-orange)" : "var(--t-faint)",
                fontWeight: i === currentStep ? 700 : 400,
              }}
            >
              {step}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" data-panel-no-drag="true">
        <button
          type="button"
          onClick={() => void handleGeneratePost(item)}
          disabled={postActionId === item.id}
          className="rounded-lg bg-[var(--color-kuma-orange)] px-2 py-1 text-[10px] font-semibold text-white"
        >
          {item.threadPosts.length > 0 ? "재생성" : "초안 생성"}
        </button>
        <button
          type="button"
          onClick={() => openPreview(item)}
          className="rounded-lg px-2 py-1 text-[10px] font-semibold"
          style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
        >
          {previewOpenId === item.id ? "미리보기 닫기" : "포스트 보기"}
        </button>
        {item.experimentId ? (
          <button
            type="button"
            data-panel-no-drag="true"
            onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-experiment", { detail: { id: item.experimentId } }))}
            className="rounded-lg px-2 py-1 text-[10px] font-semibold"
            style={{ background: "color-mix(in srgb, #a855f7 15%, transparent)", color: "#a855f7" }}
          >
            실험 보기 →
          </button>
        ) : null}
        {item.researchSuggestion && !item.experimentId ? (
          <button
            type="button"
            onClick={() => void handleStartResearch(item)}
            disabled={researchActionId === item.id}
            className="rounded-lg bg-fuchsia-600 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
          >
            {researchActionId === item.id ? "연구 시작 중" : "연구 시작"}
          </button>
        ) : null}
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
  );
  };

  return (
    <section
      ref={sectionRef}
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
                <option value="research-result">연구 결과</option>
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
            <>
              {researchSuggestionItems.length > 0 ? (
                <div
                  className="col-span-full rounded-2xl border px-3 py-3"
                  style={{ borderColor: "var(--card-border)", background: "color-mix(in srgb, var(--color-kuma-orange) 8%, var(--card-bg))" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-[12px] font-semibold">🔬 연구 제안</h4>
                      <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>
                        트렌드 점수가 높은 카드입니다. 필요하면 바로 실험 파이프라인으로 보낼 수 있습니다.
                      </p>
                    </div>
                    <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
                      {researchSuggestionItems.length}건
                    </span>
                  </div>
                </div>
              ) : null}

              {researchSuggestionItems.map(renderContentCard)}

              {researchResultItems.length > 0 ? (
                <div className="col-span-full px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
                  연구 결과 카드
                </div>
              ) : null}

              {researchResultItems.map(renderContentCard)}

              {regularItems.length > 0 ? (
                <div className="col-span-full px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>
                  Threads 카드
                </div>
              ) : null}

              {regularItems.map(renderContentCard)}
            </>
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
