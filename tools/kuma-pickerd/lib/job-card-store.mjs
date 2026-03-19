import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { sanitizeSessionId } from "./dev-selection-normalize.mjs";
import { resolveKumaPickerStateDir } from "./state-home.mjs";

const MAX_JOB_CARDS = 5;
const ALLOWED_STATUSES = new Set(["noted", "in_progress", "completed"]);

function currentTimestamp() {
  return new Date().toISOString();
}

function normalizeTarget(target) {
  const candidate = target && typeof target === "object" ? target : {};
  const tabId = Number.isInteger(candidate.tabId) ? candidate.tabId : null;
  const url = typeof candidate.url === "string" && candidate.url.trim() ? candidate.url.trim() : null;
  const urlContains =
    typeof candidate.urlContains === "string" && candidate.urlContains.trim()
      ? candidate.urlContains.trim()
      : null;

  if (tabId == null && !url && !urlContains) {
    return null;
  }

  return {
    tabId,
    url,
    urlContains,
  };
}

function normalizeRect(rect) {
  const candidate = rect && typeof rect === "object" ? rect : {};
  return {
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0,
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
  };
}

function normalizePoint(point) {
  const candidate = point && typeof point === "object" ? point : {};
  const x = typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : null;
  const y = typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : null;

  if (x == null || y == null) {
    return null;
  }

  return {
    x,
    y,
  };
}

function normalizePosition(position) {
  const candidate = position && typeof position === "object" ? position : {};
  const left = typeof candidate.left === "number" && Number.isFinite(candidate.left) ? candidate.left : null;
  const top = typeof candidate.top === "number" && Number.isFinite(candidate.top) ? candidate.top : null;

  if (left == null || top == null) {
    return null;
  }

  return {
    left,
    top,
  };
}

function normalizeAnchor(anchor) {
  const candidate = anchor && typeof anchor === "object" ? anchor : {};
  const selector =
    typeof candidate.selector === "string" && candidate.selector.trim() ? candidate.selector.trim() : null;
  const selectorPath =
    typeof candidate.selectorPath === "string" && candidate.selectorPath.trim()
      ? candidate.selectorPath.trim()
      : null;
  const rectCandidate =
    candidate.rect && typeof candidate.rect === "object" ? normalizeRect(candidate.rect) : null;
  const rect =
    rectCandidate && (rectCandidate.width > 0 || rectCandidate.height > 0 || rectCandidate.x > 0 || rectCandidate.y > 0)
      ? rectCandidate
      : null;
  const point = normalizePoint(candidate.point);

  if (!selector && !selectorPath && !rect && !point) {
    return null;
  }

  return {
    selector,
    selectorPath,
    rect,
    point,
  };
}

function normalizeCard(card, fallback = {}) {
  const candidate = card && typeof card === "object" ? card : {};
  const createdAt =
    typeof candidate.createdAt === "string" && candidate.createdAt.trim()
      ? candidate.createdAt
      : typeof fallback.createdAt === "string" && fallback.createdAt.trim()
        ? fallback.createdAt
        : currentTimestamp();
  const updatedAt =
    typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
      ? candidate.updatedAt
      : currentTimestamp();
  const id =
    typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : typeof fallback.id === "string" && fallback.id.trim()
        ? fallback.id.trim()
        : `job-${Date.now().toString(36)}`;
  const sessionId =
    sanitizeSessionId(candidate.sessionId) ??
    sanitizeSessionId(fallback.sessionId) ??
    null;
  const selectionId =
    typeof candidate.selectionId === "string" && candidate.selectionId.trim()
      ? candidate.selectionId.trim()
      : typeof fallback.selectionId === "string" && fallback.selectionId.trim()
        ? fallback.selectionId.trim()
        : null;
  const status = ALLOWED_STATUSES.has(candidate.status)
    ? candidate.status
    : ALLOWED_STATUSES.has(fallback.status)
      ? fallback.status
      : "noted";
  const candidateMessage = typeof candidate.message === "string" ? candidate.message.trim() : "";
  const fallbackMessage = typeof fallback.message === "string" ? fallback.message.trim() : "";
  const requestMessage =
    typeof candidate.requestMessage === "string" && candidate.requestMessage.trim()
      ? candidate.requestMessage.trim()
      : typeof fallback.requestMessage === "string" && fallback.requestMessage.trim()
        ? fallback.requestMessage.trim()
        : status === "noted"
          ? candidateMessage || (fallback.status === "noted" ? fallbackMessage : "")
          : fallback.status === "noted"
            ? fallbackMessage
            : "";
  const resultMessage =
    typeof candidate.resultMessage === "string" && candidate.resultMessage.trim()
      ? candidate.resultMessage.trim()
      : typeof fallback.resultMessage === "string" && fallback.resultMessage.trim()
        ? fallback.resultMessage.trim()
        : status === "in_progress" || status === "completed"
          ? candidateMessage || ((fallback.status === "in_progress" || fallback.status === "completed") ? fallbackMessage : "")
          : "";
  const message = resultMessage || requestMessage || candidateMessage || fallbackMessage;
  const author =
    typeof candidate.author === "string" && candidate.author.trim()
      ? candidate.author.trim()
      : typeof fallback.author === "string" && fallback.author.trim()
        ? fallback.author.trim()
        : "user";
  const target = normalizeTarget(candidate.target) ?? normalizeTarget(fallback.target);
  const anchor = normalizeAnchor(candidate.anchor) ?? normalizeAnchor(fallback.anchor);
  const position = normalizePosition(candidate.position) ?? normalizePosition(fallback.position);

  return {
    id,
    sessionId,
    selectionId,
    status,
    message,
    requestMessage,
    resultMessage,
    createdAt,
    updatedAt,
    author,
    anchor,
    target,
    position,
  };
}

export function buildJobCardFromSelection(selection, overrides = {}) {
  const sessionId = sanitizeSessionId(selection?.session?.id);
  const job = selection?.job && typeof selection.job === "object" ? selection.job : null;
  if (!sessionId || !job) {
    return null;
  }

  return normalizeCard(
    {
      id: typeof job.id === "string" && job.id.trim() ? job.id.trim() : sessionId,
      sessionId,
      selectionId: typeof job.id === "string" && job.id.trim() ? job.id.trim() : sessionId,
      status: overrides.status ?? job.status ?? "noted",
      requestMessage: overrides.requestMessage ?? job.message ?? "",
      resultMessage: overrides.resultMessage ?? "",
      message: overrides.resultMessage ?? overrides.message ?? job.message ?? "",
      createdAt: job.createdAt ?? selection.capturedAt,
      updatedAt: currentTimestamp(),
      author: overrides.author ?? job.author ?? "user",
      anchor: overrides.anchor ?? {
        selector: selection?.element?.selector ?? null,
        selectorPath: selection?.element?.selectorPath ?? null,
        rect: selection?.element?.rect ?? null,
        point: selection?.element?.pickedPoint ?? null,
      },
      target: overrides.target ?? {
        tabId: Number.isInteger(selection?.page?.tabId) ? selection.page.tabId : null,
        url: typeof selection?.page?.url === "string" ? selection.page.url : null,
        urlContains:
          typeof selection?.page?.pathname === "string" && selection.page.pathname
            ? selection.page.pathname
            : null,
      },
    },
    {
      sessionId,
      selectionId: typeof job.id === "string" && job.id.trim() ? job.id.trim() : sessionId,
    },
  );
}

export class JobCardStore {
  constructor(root) {
    this.root = resolve(root);
    this.stateDir = resolveKumaPickerStateDir();
    this.feedPath = resolve(this.stateDir, "job-cards.json");
  }

  ensureDirectory() {
    mkdirSync(dirname(this.feedPath), { recursive: true });
  }

  readAll() {
    this.ensureDirectory();

    try {
      const parsed = JSON.parse(readFileSync(this.feedPath, "utf8"));
      const cards = Array.isArray(parsed?.cards)
        ? parsed.cards
            .map((entry) => normalizeCard(entry))
            .filter((entry) => entry.message || entry.requestMessage || entry.resultMessage || entry.target || entry.anchor)
        : [];

      return {
        version: 1,
        updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : currentTimestamp(),
        cards: cards
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
          .slice(-MAX_JOB_CARDS),
      };
    } catch {
      return {
        version: 1,
        updatedAt: currentTimestamp(),
        cards: [],
      };
    }
  }

  readBySession(sessionId) {
    const normalizedId = sanitizeSessionId(sessionId);
    if (!normalizedId) {
      return null;
    }

    return this.readAll().cards.find((card) => card.sessionId === normalizedId) ?? null;
  }

  deleteBySession(sessionId) {
    const normalizedId = sanitizeSessionId(sessionId);
    if (!normalizedId) {
      return null;
    }

    const feed = this.readAll();
    const deleted = feed.cards.find((card) => card.sessionId === normalizedId) ?? null;
    if (!deleted) {
      return null;
    }

    const nextFeed = {
      version: 1,
      updatedAt: currentTimestamp(),
      cards: feed.cards.filter((card) => card.sessionId !== normalizedId),
    };

    writeFileSync(this.feedPath, `${JSON.stringify(nextFeed, null, 2)}\n`, "utf8");
    return deleted;
  }

  clearAll() {
    rmSync(this.feedPath, { force: true });
    this.ensureDirectory();
  }

  write(cardInput, fallback = {}) {
    this.ensureDirectory();
    const feed = this.readAll();
    const fallbackCard =
      (fallback.sessionId ? feed.cards.find((card) => card.sessionId === fallback.sessionId) : null) ??
      (fallback.id ? feed.cards.find((card) => card.id === fallback.id) : null) ??
      null;
    const nextCard = normalizeCard(cardInput, fallbackCard ?? fallback);

    const nextCards = [...feed.cards.filter((card) => card.id !== nextCard.id && card.sessionId !== nextCard.sessionId), nextCard]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(-MAX_JOB_CARDS);

    const nextFeed = {
      version: 1,
      updatedAt: nextCard.updatedAt,
      cards: nextCards,
    };

    writeFileSync(this.feedPath, `${JSON.stringify(nextFeed, null, 2)}\n`, "utf8");
    return nextCard;
  }
}
