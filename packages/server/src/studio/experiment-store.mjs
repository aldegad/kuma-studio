import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { resolveProjectStateDir } from "../state-home.mjs";

const ALLOWED_SOURCES = new Set(["ai-trend", "user-idea"]);
const ALLOWED_STATUSES = new Set(["proposed", "in-progress", "success", "failed", "abandoned"]);
const DEFAULT_TREND_SOURCES = [
  "https://hnrss.org/newest?q=AI",
  "https://www.marktechpost.com/feed/",
];

function now() {
  return new Date().toISOString();
}

function createId() {
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSources(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_TREND_SOURCES];
  }

  const sources = value
    .map((entry) => normalizeString(entry))
    .filter((entry) => typeof entry === "string");

  return sources.length > 0 ? sources : [...DEFAULT_TREND_SOURCES];
}

function resolveNullableString(candidate, base, key) {
  if (Object.prototype.hasOwnProperty.call(candidate, key)) {
    return normalizeString(candidate[key]);
  }

  return normalizeString(base[key]);
}

function normalizeSettings(settings, fallback = {}) {
  const candidate = settings && typeof settings === "object" ? settings : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const intervalCandidate = Number(candidate.trendFetchIntervalMinutes ?? base.trendFetchIntervalMinutes);

  return {
    trendSources: normalizeSources(candidate.trendSources ?? base.trendSources),
    trendFetchIntervalMinutes:
      Number.isFinite(intervalCandidate) && intervalCandidate > 0 ? Math.round(intervalCandidate) : 180,
    autoProposeTime:
      normalizeString(candidate.autoProposeTime) ?? normalizeString(base.autoProposeTime) ?? "09:00",
    lastTrendIngestedAt:
      normalizeString(candidate.lastTrendIngestedAt) ?? normalizeString(base.lastTrendIngestedAt) ?? null,
  };
}

function normalizeExperiment(item, fallback = {}) {
  const candidate = item && typeof item === "object" ? item : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const title = normalizeString(candidate.title) ?? normalizeString(base.title);

  if (!title) {
    throw new Error("title is required.");
  }

  const createdAt = normalizeString(candidate.createdAt) ?? normalizeString(base.createdAt) ?? now();

  return {
    id: normalizeString(candidate.id) ?? normalizeString(base.id) ?? createId(),
    title,
    source: ALLOWED_SOURCES.has(candidate.source)
      ? candidate.source
      : ALLOWED_SOURCES.has(base.source)
        ? base.source
        : "user-idea",
    status: ALLOWED_STATUSES.has(candidate.status)
      ? candidate.status
      : ALLOWED_STATUSES.has(base.status)
        ? base.status
        : "proposed",
    branch: resolveNullableString(candidate, base, "branch"),
    worktree: resolveNullableString(candidate, base, "worktree"),
    pr_url: resolveNullableString(candidate, base, "pr_url"),
    thread_draft: Object.prototype.hasOwnProperty.call(candidate, "thread_draft")
      ? typeof candidate.thread_draft === "string"
        ? candidate.thread_draft.trim()
        : ""
      : typeof base.thread_draft === "string"
        ? base.thread_draft
        : "",
    createdAt,
    updatedAt: normalizeString(candidate.updatedAt) ?? normalizeString(base.updatedAt) ?? now(),
  };
}

export class ExperimentStore {
  constructor(root) {
    this.root = resolve(root);
    this.stateDir = resolveProjectStateDir(this.root);
    this.filePath = resolve(this.stateDir, "experiments", "items.json");
  }

  ensureDirectory() {
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  readAll() {
    this.ensureDirectory();

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      const items = Array.isArray(parsed?.items)
        ? parsed.items.map((entry) => normalizeExperiment(entry, entry))
        : [];

      return {
        version: 1,
        updatedAt: normalizeString(parsed?.updatedAt) ?? now(),
        settings: normalizeSettings(parsed?.settings),
        items: items.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      };
    } catch {
      return {
        version: 1,
        updatedAt: now(),
        settings: normalizeSettings(null),
        items: [],
      };
    }
  }

  list() {
    return this.readAll().items;
  }

  readById(id) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
      return null;
    }

    return this.readAll().items.find((item) => item.id === normalizedId) ?? null;
  }

  write(itemInput, fallback = {}) {
    const feed = this.readAll();
    const existing =
      (fallback.id ? feed.items.find((item) => item.id === fallback.id) : null) ??
      (itemInput?.id ? feed.items.find((item) => item.id === itemInput.id) : null) ??
      null;
    const nextItem = {
      ...normalizeExperiment(itemInput, existing ?? fallback),
      updatedAt: now(),
    };

    this.#writeFeed({
      ...feed,
      updatedAt: now(),
      items: [
        nextItem,
        ...feed.items.filter((item) => item.id !== nextItem.id),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    });

    return nextItem;
  }

  update(id, patch) {
    const existing = this.readById(id);
    if (!existing) {
      return null;
    }

    return this.write({ ...existing, ...patch, id: existing.id, createdAt: existing.createdAt }, existing);
  }

  delete(id) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
      return null;
    }

    const feed = this.readAll();
    const existing = feed.items.find((item) => item.id === normalizedId) ?? null;

    if (!existing) {
      return null;
    }

    this.#writeFeed({
      ...feed,
      updatedAt: now(),
      items: feed.items.filter((item) => item.id !== normalizedId),
    });

    return existing;
  }

  getSettings() {
    return this.readAll().settings;
  }

  updateSettings(settingsPatch) {
    const feed = this.readAll();
    const settings = normalizeSettings(settingsPatch, feed.settings);
    this.#writeFeed({
      ...feed,
      updatedAt: now(),
      settings,
    });
    return settings;
  }

  #writeFeed(feed) {
    this.ensureDirectory();
    writeFileSync(this.filePath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  }
}

export function getExperimentConstants() {
  return {
    allowedSources: [...ALLOWED_SOURCES],
    allowedStatuses: [...ALLOWED_STATUSES],
    defaultTrendSources: [...DEFAULT_TREND_SOURCES],
  };
}
