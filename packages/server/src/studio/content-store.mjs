import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { resolveProjectStateDir } from "../state-home.mjs";

const ALLOWED_TYPES = new Set(["text", "image", "video"]);
const ALLOWED_STATUSES = new Set(["draft", "ready", "posted", "hold"]);

function now() {
  return new Date().toISOString();
}

function createId() {
  return `content-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeScheduledFor(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("scheduledFor must be a string or null.");
  }

  const iso = new Date(value);
  if (Number.isNaN(iso.getTime())) {
    throw new Error("scheduledFor must be a valid ISO date string.");
  }

  return iso.toISOString();
}

function normalizeAssignee(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("assignee must be a string or null.");
  }

  return value.trim() || null;
}

function normalizeItem(item, fallback = {}) {
  const candidate = item && typeof item === "object" ? item : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const project = normalizeOptionalString(candidate.project) ?? normalizeOptionalString(base.project);
  const title = normalizeOptionalString(candidate.title) ?? normalizeOptionalString(base.title);

  if (!project) {
    throw new Error("project is required.");
  }

  if (!title) {
    throw new Error("title is required.");
  }

  const type = ALLOWED_TYPES.has(candidate.type)
    ? candidate.type
    : ALLOWED_TYPES.has(base.type)
      ? base.type
      : "text";
  const status = ALLOWED_STATUSES.has(candidate.status)
    ? candidate.status
    : ALLOWED_STATUSES.has(base.status)
      ? base.status
      : "draft";
  const createdAt =
    normalizeOptionalString(candidate.createdAt) ??
    normalizeOptionalString(base.createdAt) ??
    now();
  const updatedAt =
    normalizeOptionalString(candidate.updatedAt) ??
    normalizeOptionalString(base.updatedAt) ??
    now();

  return {
    id: normalizeOptionalString(candidate.id) ?? normalizeOptionalString(base.id) ?? createId(),
    project,
    type,
    title,
    body:
      typeof candidate.body === "string"
        ? candidate.body.trim()
        : typeof base.body === "string"
          ? base.body
          : "",
    status,
    scheduledFor:
      Object.prototype.hasOwnProperty.call(candidate, "scheduledFor")
        ? normalizeScheduledFor(candidate.scheduledFor)
        : normalizeScheduledFor(base.scheduledFor),
    assignee:
      Object.prototype.hasOwnProperty.call(candidate, "assignee")
        ? normalizeAssignee(candidate.assignee)
        : normalizeAssignee(base.assignee),
    createdAt,
    updatedAt,
  };
}

export class ContentStore {
  constructor(root) {
    this.root = resolve(root);
    this.stateDir = resolveProjectStateDir(this.root);
    this.filePath = resolve(this.stateDir, "content", "items.json");
  }

  ensureDirectory() {
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  readAll() {
    this.ensureDirectory();

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      const items = Array.isArray(parsed?.items)
        ? parsed.items.map((entry) => normalizeItem(entry, entry))
        : [];

      return {
        version: 1,
        updatedAt: normalizeOptionalString(parsed?.updatedAt) ?? now(),
        items: items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      };
    } catch {
      return {
        version: 1,
        updatedAt: now(),
        items: [],
      };
    }
  }

  readById(id) {
    const normalizedId = normalizeOptionalString(id);
    if (!normalizedId) {
      return null;
    }

    return this.readAll().items.find((item) => item.id === normalizedId) ?? null;
  }

  list(project = null, assignee = undefined) {
    const normalizedProject = normalizeOptionalString(project);
    const normalizedAssignee =
      assignee === undefined ? undefined : assignee === null ? null : normalizeOptionalString(assignee);
    const feed = this.readAll();

    return feed.items.filter((item) => {
      if (normalizedProject && item.project !== normalizedProject) {
        return false;
      }

      if (normalizedAssignee === undefined) {
        return true;
      }

      if (normalizedAssignee === null) {
        return item.assignee == null;
      }

      return item.assignee === normalizedAssignee;
    });
  }

  write(itemInput, fallback = {}) {
    const feed = this.readAll();
    const existing =
      (fallback.id ? feed.items.find((item) => item.id === fallback.id) : null) ??
      (itemInput?.id ? feed.items.find((item) => item.id === itemInput.id) : null) ??
      null;
    const nextItem = {
      ...normalizeItem(itemInput, existing ?? fallback),
      updatedAt: now(),
    };
    const items = [
      nextItem,
      ...feed.items.filter((item) => item.id !== nextItem.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    this.#writeFeed({
      version: 1,
      updatedAt: now(),
      items,
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

  updateStatus(id, status, extraPatch = {}) {
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error(`Unsupported status: ${status}`);
    }

    return this.update(id, { ...extraPatch, status });
  }

  delete(id) {
    const normalizedId = normalizeOptionalString(id);
    if (!normalizedId) {
      return null;
    }

    const feed = this.readAll();
    const existing = feed.items.find((item) => item.id === normalizedId) ?? null;

    if (!existing) {
      return null;
    }

    this.#writeFeed({
      version: 1,
      updatedAt: now(),
      items: feed.items.filter((item) => item.id !== normalizedId),
    });

    return existing;
  }

  #writeFeed(feed) {
    this.ensureDirectory();
    writeFileSync(this.filePath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  }
}

export function getContentConstants() {
  return {
    allowedTypes: [...ALLOWED_TYPES],
    allowedStatuses: [...ALLOWED_STATUSES],
  };
}
