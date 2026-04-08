import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";

import {
  createExperiment,
  deleteExperiment,
  fetchContentItems,
  fetchExperiments,
  ingestTrendExperiments,
  updateExperimentSettings,
  updateExperimentStatus,
} from "../../lib/api";
import type { ContentItem } from "../../types/content";
import type {
  ExperimentItem,
  ExperimentSettings,
  ExperimentSource,
  ExperimentStatus,
} from "../../types/experiment";

type ExperimentColumnId = "proposed" | "in-progress" | "success" | "failed";

const COLUMN_ORDER: ExperimentColumnId[] = ["proposed", "in-progress", "success", "failed"];
const COLUMN_LABEL: Record<ExperimentColumnId, string> = {
  proposed: "Proposed",
  "in-progress": "In Progress",
  success: "Success",
  failed: "Failed",
};
const SOURCE_LABEL: Record<ExperimentSource, string> = {
  "ai-trend": "AI Trend",
  "user-idea": "User Idea",
};

interface TimelineEvent {
  id: string;
  title: string;
  detail: string;
  time: string;
  pipeline: "content" | "experiment";
  dotColor: string;
}

function buildTimelineEvents(experiments: ExperimentItem[], contentItems: ContentItem[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const exp of experiments) {
    const statusLabel = exp.status === "success" ? "성공" : exp.status === "failed" ? "실패" : exp.status === "in-progress" ? "진행중" : "제안";
    events.push({
      id: `exp-${exp.id}`,
      title: exp.title,
      detail: `실험 · ${statusLabel}${exp.pr_url ? " · PR" : ""}`,
      time: exp.updatedAt,
      pipeline: "experiment",
      dotColor: exp.status === "success" ? "#10b981" : exp.status === "failed" ? "#ef4444" : exp.status === "in-progress" ? "#3b82f6" : "#78716c",
    });
  }

  for (const c of contentItems) {
    const label = c.status === "posted" ? "발행" : c.postStatus === "approved" ? "승인" : c.postStatus === "preview" ? "포스트" : "초안";
    events.push({
      id: `content-${c.id}`,
      title: c.title,
      detail: `콘텐츠 · ${label}`,
      time: c.updatedAt,
      pipeline: "content",
      dotColor: c.status === "posted" ? "#0ea5e9" : c.postStatus === "approved" ? "#f59e0b" : "#78716c",
    });
  }

  events.sort((a, b) => b.time.localeCompare(a.time));
  return events.slice(0, 12);
}

function defaultSettings(): ExperimentSettings {
  return {
    trendSources: ["https://hnrss.org/newest?q=AI", "https://www.marktechpost.com/feed/"],
    trendFetchIntervalMinutes: 180,
    autoProposeTime: "09:00",
    lastTrendIngestedAt: null,
  };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "아직 없음";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "아직 없음";
  }
  return date.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nextSchedulePreview(settings: ExperimentSettings) {
  const entries: string[] = [];
  const now = new Date();

  for (let index = 1; index <= 3; index += 1) {
    const intervalRun = new Date(now.getTime() + settings.trendFetchIntervalMinutes * 60_000 * index);
    entries.push(`트렌드 수집 ${index}: ${formatDateTime(intervalRun.toISOString())}`);
  }

  if (settings.autoProposeTime) {
    const [hourText, minuteText] = settings.autoProposeTime.split(":");
    const nextAuto = new Date(now);
    nextAuto.setHours(Number(hourText) || 9, Number(minuteText) || 0, 0, 0);
    if (nextAuto.getTime() <= now.getTime()) {
      nextAuto.setDate(nextAuto.getDate() + 1);
    }
    entries.unshift(`자동 제안: ${formatDateTime(nextAuto.toISOString())}`);
  }

  return entries;
}

export function ExperimentPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [items, setItems] = useState<ExperimentItem[]>([]);
  const [settings, setSettings] = useState<ExperimentSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<ExperimentSource>("user-idea");
  const [settingsDraft, setSettingsDraft] = useState(() => defaultSettings());
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [highlightedExpId, setHighlightedExpId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [expResponse, contentResponse] = await Promise.all([
        fetchExperiments(),
        fetchContentItems(),
      ]);
      setItems(expResponse.items);
      setSettings(expResponse.settings);
      setSettingsDraft(expResponse.settings);
      setContentItems(contentResponse.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "실험 보드를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string } | undefined;
      if (!detail?.id) return;
      const found = items.find((item) => item.id === detail.id);
      if (!found) return;
      setCollapsed(false);
      setHighlightedExpId(detail.id);
      setTimeout(() => {
        sectionRef.current?.querySelector(`[data-experiment-id="${detail.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      setTimeout(() => setHighlightedExpId(null), 2500);
    };
    window.addEventListener("navigate-to-experiment", handler);
    return () => window.removeEventListener("navigate-to-experiment", handler);
  }, [items]);

  const grouped = useMemo<Record<ExperimentColumnId, ExperimentItem[]>>(() => ({
    proposed: items.filter((item) => item.status === "proposed"),
    "in-progress": items.filter((item) => item.status === "in-progress"),
    success: items.filter((item) => item.status === "success"),
    failed: items.filter((item) => item.status === "failed" || item.status === "abandoned"),
  }), [items]);

  const schedulePreview = useMemo(() => nextSchedulePreview(settings), [settings]);

  const timelineEvents = useMemo(() => buildTimelineEvents(items, contentItems), [items, contentItems]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createExperiment({ title, source });
      setTitle("");
      setSource("user-idea");
      setShowForm(false);
      await loadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "실험 생성에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (item: ExperimentItem, status: ExperimentStatus) => {
    try {
      await updateExperimentStatus(item.id, status);
      await loadData();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "상태 전이에 실패했습니다.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteExperiment(id);
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "실험 삭제에 실패했습니다.");
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>, status: ExperimentStatus) => {
    event.preventDefault();
    const experimentId = event.dataTransfer.getData("text/plain");
    const item = items.find((entry) => entry.id === experimentId);
    if (!item || item.status === status) {
      return;
    }
    await handleStatusChange(item, status);
  };

  const handleSettingsSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const nextSettings = await updateExperimentSettings({
        trendSources: settingsDraft.trendSources,
        trendFetchIntervalMinutes: settingsDraft.trendFetchIntervalMinutes,
        autoProposeTime: settingsDraft.autoProposeTime,
      });
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setShowSettings(false);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "설정 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleIngest = async () => {
    setIngesting(true);
    try {
      const response = await ingestTrendExperiments();
      setItems(response.items);
      setSettings(response.settings);
      setSettingsDraft(response.settings);
      await loadData();
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "트렌드 취합에 실패했습니다.");
    } finally {
      setIngesting(false);
    }
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby="experiment-panel-title"
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
          id="experiment-panel-title"
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "var(--t-muted)" }}
        >
          Experiment Pipeline ({items.length})
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
            onClick={() => void handleIngest()}
            className="rounded-lg px-2.5 py-1 text-[10px] font-semibold"
            style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
          >
            {ingesting ? "수집 중" : "트렌드 취합"}
          </button>
          <button
            type="button"
            data-panel-no-drag="true"
            onClick={() => setShowSettings((value) => !value)}
            className="rounded-lg px-2.5 py-1 text-[10px] font-semibold"
            style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
          >
            스케줄
          </button>
          <button
            type="button"
            data-panel-no-drag="true"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-lg bg-[var(--color-kuma-orange)] px-2.5 py-1 text-[10px] font-semibold text-white"
          >
            새 실험
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

        {showForm ? (
          <form
            onSubmit={handleCreate}
            className="space-y-2 rounded-xl border p-3"
            style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
            data-panel-no-drag="true"
          >
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="실험 제목"
              className="w-full rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
            />
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as ExperimentSource)}
              className="w-full rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
            >
              <option value="user-idea">User Idea</option>
              <option value="ai-trend">AI Trend</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-panel-no-drag="true"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-2.5 py-1 text-[10px]"
                style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
              >
                취소
              </button>
              <button type="submit" data-panel-no-drag="true" disabled={saving} className="rounded-lg bg-[var(--color-kuma-orange)] px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-60">
                {saving ? "생성 중" : "실험 생성"}
              </button>
            </div>
          </form>
        ) : null}

        {showSettings ? (
          <form
            onSubmit={handleSettingsSave}
            className="space-y-2 rounded-xl border p-3"
            style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
            data-panel-no-drag="true"
          >
            <textarea
              rows={4}
              value={settingsDraft.trendSources.join("\n")}
              onChange={(event) => setSettingsDraft((current) => ({
                ...current,
                trendSources: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
              }))}
              className="w-full resize-none rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={15}
                step={15}
                value={settingsDraft.trendFetchIntervalMinutes}
                onChange={(event) => setSettingsDraft((current) => ({
                  ...current,
                  trendFetchIntervalMinutes: Number(event.target.value) || 180,
                }))}
                className="rounded-lg border px-2 py-1.5 text-[11px]"
                style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
              />
              <input
                type="time"
                value={settingsDraft.autoProposeTime}
                onChange={(event) => setSettingsDraft((current) => ({
                  ...current,
                  autoProposeTime: event.target.value,
                }))}
                className="rounded-lg border px-2 py-1.5 text-[11px]"
                style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--t-primary)" }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-panel-no-drag="true"
                onClick={() => setShowSettings(false)}
                className="rounded-lg px-2.5 py-1 text-[10px]"
                style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)" }}
              >
                닫기
              </button>
              <button type="submit" data-panel-no-drag="true" disabled={saving} className="rounded-lg bg-[var(--color-kuma-orange)] px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-60">
                설정 저장
              </button>
            </div>
          </form>
        ) : null}

        <div
          className="rounded-2xl border p-3"
          style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
        >
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-semibold">통합 파이프라인 타임라인</h4>
            <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
              마지막 수집: {formatDateTime(settings.lastTrendIngestedAt)}
            </span>
          </div>
          <div className="mt-1.5 flex gap-3 text-[9px]" style={{ color: "var(--t-faint)" }}>
            <span className="flex items-center gap-1">
              <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: "#3b82f6" }} />
              실험
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: "#0ea5e9" }} />
              콘텐츠
            </span>
          </div>
          <div className="mt-3 space-y-0">
            {timelineEvents.length === 0 ? (
              <p className="py-3 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>
                타임라인 이벤트 없음
              </p>
            ) : (
              timelineEvents.map((event, i) => (
                <div key={event.id} className="flex gap-2.5">
                  <div className="flex flex-col items-center" style={{ width: "12px" }}>
                    <div
                      className="mt-1.5 h-[8px] w-[8px] shrink-0 rounded-full"
                      style={{ background: event.dotColor, boxShadow: `0 0 4px ${event.dotColor}40` }}
                    />
                    {i < timelineEvents.length - 1 && (
                      <div className="my-0.5 w-px flex-1" style={{ background: "var(--panel-border)" }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[10px] font-semibold">{event.title}</span>
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold"
                        style={{
                          background: event.pipeline === "experiment"
                            ? "color-mix(in srgb, #3b82f6 15%, transparent)"
                            : "color-mix(in srgb, #0ea5e9 15%, transparent)",
                          color: event.pipeline === "experiment" ? "#3b82f6" : "#0ea5e9",
                        }}
                      >
                        {event.detail}
                      </span>
                    </div>
                    <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>
                      {formatDateTime(event.time)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: "var(--panel-border)" }}>
            <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-faint)" }}>
              예정
            </div>
            {schedulePreview.map((entry) => (
              <div
                key={entry}
                className="rounded-lg px-2 py-1 text-[10px]"
                style={{ background: "var(--badge-bg)", color: "var(--t-muted)" }}
              >
                {entry}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          {COLUMN_ORDER.map((status) => (
            <div
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleDrop(event, status)}
              className="rounded-2xl border p-3"
              style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-[12px] font-semibold">{COLUMN_LABEL[status]}</h4>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px]"
                  style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                >
                  {grouped[status].length}
                </span>
              </div>
              <div className="space-y-2">
                {loading ? (
                  <p
                    className="rounded-xl px-3 py-5 text-center text-[11px]"
                    style={{ background: "var(--badge-bg)", color: "var(--t-muted)" }}
                  >
                    불러오는 중
                  </p>
                ) : grouped[status].length === 0 ? (
                  <p
                    className="rounded-xl px-3 py-5 text-center text-[11px]"
                    style={{ background: "var(--badge-bg)", color: "var(--t-muted)" }}
                  >
                    카드 없음
                  </p>
                ) : (
                  grouped[status].map((item) => (
                    <article
                      key={item.id}
                      data-experiment-id={item.id}
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
                      className="rounded-2xl border p-3 cursor-grab active:cursor-grabbing transition-all duration-500"
                      style={{
                        borderColor: highlightedExpId === item.id ? "var(--color-kuma-orange)" : "var(--card-border)",
                        background: highlightedExpId === item.id ? "color-mix(in srgb, var(--color-kuma-orange) 8%, var(--card-bg))" : "var(--card-bg)",
                        boxShadow: highlightedExpId === item.id ? "0 0 12px rgba(234, 88, 12, 0.2)" : "none",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px]"
                              style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                            >
                              {SOURCE_LABEL[item.source]}
                            </span>
                            <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
                              {formatDateTime(item.createdAt)}
                            </span>
                          </div>
                          <h5 className="mt-2 text-[12px] font-semibold leading-snug">{item.title}</h5>
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

                      <div
                        className="mt-3 rounded-xl px-2.5 py-2 text-[10px]"
                        style={{ background: "var(--badge-bg)", color: "var(--badge-text)" }}
                      >
                        <div>branch: {item.branch ?? "미생성"}</div>
                        <div className="mt-1 truncate">worktree: {item.worktree ?? "미생성"}</div>
                      </div>

                      {item.pr_url ? (
                        <a
                          href={item.pr_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex text-[10px] font-semibold text-sky-500 underline"
                        >
                          PR 보기
                        </a>
                      ) : null}

                      {item.thread_draft ? (
                        <div
                          className="mt-3 rounded-xl px-2.5 py-2 text-[10px] whitespace-pre-wrap"
                          style={{ background: "var(--badge-bg)", color: "var(--t-secondary)" }}
                        >
                          {item.thread_draft}
                        </div>
                      ) : null}

                      {(item.sourceContentId || item.resultContentId) ? (
                        <div className="mt-2 flex flex-wrap gap-1.5" data-panel-no-drag="true">
                          {item.sourceContentId ? (
                            <button
                              type="button"
                              onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-content", { detail: { id: item.sourceContentId } }))}
                              className="rounded-lg px-2 py-1 text-[10px] font-semibold"
                              style={{ background: "color-mix(in srgb, #0ea5e9 15%, transparent)", color: "#0ea5e9" }}
                            >
                              원본 콘텐츠 →
                            </button>
                          ) : null}
                          {item.resultContentId ? (
                            <button
                              type="button"
                              onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-content", { detail: { id: item.resultContentId } }))}
                              className="rounded-lg px-2 py-1 text-[10px] font-semibold"
                              style={{ background: "color-mix(in srgb, #10b981 15%, transparent)", color: "#10b981" }}
                            >
                              연구 결과 →
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-1.5" data-panel-no-drag="true">
                        {status !== "proposed" ? (
                          <button
                            type="button"
                            onClick={() => void handleStatusChange(item, "proposed")}
                            className="rounded-lg px-2 py-1 text-[10px]"
                            style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-text)" }}
                          >
                            제안
                          </button>
                        ) : null}
                        {status !== "in-progress" ? (
                          <button type="button" onClick={() => void handleStatusChange(item, "in-progress")} className="rounded-lg bg-blue-500 px-2 py-1 text-[10px] font-semibold text-white">
                            시작
                          </button>
                        ) : null}
                        {status !== "success" ? (
                          <button type="button" onClick={() => void handleStatusChange(item, "success")} className="rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white">
                            성공
                          </button>
                        ) : null}
                        {status !== "failed" ? (
                          <button type="button" onClick={() => void handleStatusChange(item, "failed")} className="rounded-lg bg-red-500 px-2 py-1 text-[10px] font-semibold text-white">
                            실패
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </section>
  );
}
