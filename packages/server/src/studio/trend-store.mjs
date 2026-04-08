import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { resolveProjectStateDir } from "../state-home.mjs";

const DEFAULT_TREND_SETTINGS = {
  autoResearch: false,
};

function now() {
  return new Date().toISOString();
}

function createId() {
  return `trend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequiredString(value, fieldName) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizePublishedAt(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("publishedAt must be a string or null.");
  }

  const iso = new Date(value);
  if (Number.isNaN(iso.getTime())) {
    throw new Error("publishedAt must be a valid ISO date string.");
  }

  return iso.toISOString();
}

function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((entry) => normalizeOptionalString(entry))
      .filter((entry) => typeof entry === "string"),
  )];
}

function normalizeRelevanceScore(value, fallbackValue = 0) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const numericFallback = Number(fallbackValue);
  return Number.isFinite(numericFallback) ? numericFallback : 0;
}

function compareTrendItems(left, right) {
  const leftKey = left.publishedAt ?? left.updatedAt;
  const rightKey = right.publishedAt ?? right.updatedAt;
  return rightKey.localeCompare(leftKey);
}

function normalizeSettings(value, fallback = DEFAULT_TREND_SETTINGS) {
  const candidate = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_TREND_SETTINGS;

  return {
    autoResearch:
      Object.prototype.hasOwnProperty.call(candidate, "autoResearch")
        ? candidate.autoResearch === true
        : base.autoResearch === true,
  };
}

function normalizeTrendItem(item, fallback = {}) {
  const candidate = item && typeof item === "object" ? item : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const createdAt =
    normalizeOptionalString(candidate.createdAt) ??
    normalizeOptionalString(base.createdAt) ??
    now();

  return {
    id: normalizeOptionalString(candidate.id) ?? normalizeOptionalString(base.id) ?? createId(),
    feedUrl: normalizeRequiredString(candidate.feedUrl ?? base.feedUrl, "feedUrl"),
    articleUrl: normalizeRequiredString(candidate.articleUrl ?? base.articleUrl, "articleUrl"),
    title: normalizeRequiredString(candidate.title ?? base.title, "title"),
    summary:
      typeof candidate.summary === "string"
        ? candidate.summary.trim()
        : typeof base.summary === "string"
          ? base.summary
          : "",
    publishedAt: normalizePublishedAt(candidate.publishedAt ?? base.publishedAt),
    tags: normalizeTags(candidate.tags ?? base.tags),
    relevanceScore: normalizeRelevanceScore(candidate.relevanceScore, base.relevanceScore),
    createdAt,
    updatedAt:
      normalizeOptionalString(candidate.updatedAt) ??
      normalizeOptionalString(base.updatedAt) ??
      now(),
  };
}

export class TrendStore {
  constructor(root) {
    this.root = resolve(root);
    this.stateDir = resolveProjectStateDir(this.root);
    this.filePath = resolve(this.stateDir, "trends", "items.json");
  }

  ensureDirectory() {
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  readAll() {
    this.ensureDirectory();

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      const items = Array.isArray(parsed?.items)
        ? parsed.items.map((entry) => normalizeTrendItem(entry, entry))
        : [];

      return {
        version: 1,
        updatedAt: normalizeOptionalString(parsed?.updatedAt) ?? now(),
        settings: normalizeSettings(parsed?.settings),
        items: items.sort(compareTrendItems),
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

  list(feedUrl = null) {
    const normalizedFeedUrl = normalizeOptionalString(feedUrl);
    const feed = this.readAll();

    if (!normalizedFeedUrl) {
      return feed.items;
    }

    return feed.items.filter((item) => item.feedUrl === normalizedFeedUrl);
  }

  readById(id) {
    const normalizedId = normalizeOptionalString(id);
    if (!normalizedId) {
      return null;
    }

    return this.readAll().items.find((item) => item.id === normalizedId) ?? null;
  }

  readByArticleUrl(articleUrl) {
    const normalizedArticleUrl = normalizeOptionalString(articleUrl);
    if (!normalizedArticleUrl) {
      return null;
    }

    return this.readAll().items.find((item) => item.articleUrl === normalizedArticleUrl) ?? null;
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

  write(itemInput, fallback = {}) {
    const feed = this.readAll();
    const existing =
      (fallback.articleUrl ? feed.items.find((item) => item.articleUrl === fallback.articleUrl) : null) ??
      (itemInput?.articleUrl ? feed.items.find((item) => item.articleUrl === itemInput.articleUrl) : null) ??
      (fallback.id ? feed.items.find((item) => item.id === fallback.id) : null) ??
      (itemInput?.id ? feed.items.find((item) => item.id === itemInput.id) : null) ??
      null;
    const nextItem = {
      ...normalizeTrendItem(itemInput, existing ?? fallback),
      updatedAt: now(),
    };
    const items = [
      nextItem,
      ...feed.items.filter((item) => item.id !== nextItem.id),
    ].sort(compareTrendItems);

    this.#writeFeed({
      version: 1,
      updatedAt: now(),
      settings: feed.settings,
      items,
    });

    return nextItem;
  }

  #writeFeed(feed) {
    this.ensureDirectory();
    writeFileSync(this.filePath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  }
}
