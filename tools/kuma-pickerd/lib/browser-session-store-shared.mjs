import { randomUUID } from "node:crypto";

const STALE_AFTER_MS = 15_000;
const MAX_CAPABILITIES = 32;
const MAX_TEXT_LENGTH = 2_000;

export const MAX_COMMANDS = 100;
export { MAX_TEXT_LENGTH };

export function sanitizeString(value, maxLength = 256) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function sanitizeOptionalInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function sanitizeRole(value) {
  return value === "browser" || value === "controller" ? value : null;
}

export function sanitizePage(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return {
    url: sanitizeString(candidate.url, 2_000),
    pathname: sanitizeString(candidate.pathname, 1_000),
    title: sanitizeString(candidate.title, 512),
  };
}

export function sanitizeCapabilities(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return Array.from(
    new Set(
      candidate
        .map((entry) => sanitizeString(entry, 64))
        .filter(Boolean),
    ),
  ).slice(0, MAX_CAPABILITIES);
}

function sanitizeRequestId(value) {
  const candidate = sanitizeString(value, 128);
  return candidate && /^[a-zA-Z0-9:_-]{6,128}$/.test(candidate) ? candidate : null;
}

function sanitizeClipRect(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }

  if (width < 1 || height < 1) {
    return null;
  }

  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function sanitizeWaypoints(candidate) {
  if (!Array.isArray(candidate) || candidate.length < 2) {
    return null;
  }

  const points = candidate
    .map((entry) => {
      const x = Number(entry?.x);
      const y = Number(entry?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }

      return {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
      };
    })
    .filter(Boolean);

  return points.length >= 2 ? points : null;
}

function sanitizeFileList(candidate) {
  if (!Array.isArray(candidate)) {
    return null;
  }

  const files = candidate
    .map((entry) => sanitizeString(entry, 4_000))
    .filter(Boolean);

  return files.length > 0 ? files : null;
}

export function sanitizeCommandPayload(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Browser command payload must be an object.");
  }

  const type = sanitizeString(candidate.type, 64);
  if (!type) {
    throw new Error("Browser command type is required.");
  }

  const selector = sanitizeString(candidate.selector, 1_200);
  const selectorPath = sanitizeString(candidate.selectorPath, 2_000);
  const label = sanitizeString(candidate.label, 512);
  const text = sanitizeString(candidate.text, 512);
  const value = typeof candidate.value === "string" ? candidate.value.slice(0, 4_000) : null;
  const expression = typeof candidate.expression === "string" ? candidate.expression.slice(0, 8_000) : null;
  const key = sanitizeString(candidate.key, 64);
  const button = sanitizeString(candidate.button, 16);
  const kind = sanitizeString(candidate.kind, 64);
  const role = sanitizeString(candidate.role, 64);
  const within = sanitizeString(candidate.within, 512);
  const scope = sanitizeString(candidate.scope, 32);
  const targetUrl = sanitizeString(candidate.targetUrl, 2_000);
  const targetUrlContains = sanitizeString(candidate.targetUrlContains, 1_000);
  const navigationUrl = sanitizeString(candidate.navigationUrl, 2_000);
  const filename = sanitizeString(candidate.filename, 512);
  const filenameContains = sanitizeString(candidate.filenameContains, 512);
  const downloadUrlContains = sanitizeString(candidate.downloadUrlContains, 2_000);
  const postActionDelayMs = Number(candidate.postActionDelayMs);
  const captureMs = Number(candidate.captureMs);
  const fps = Number(candidate.fps);
  const speedMultiplier = Number(candidate.speedMultiplier);
  const timeoutMs = Number(candidate.timeoutMs);
  const holdMs = Number(candidate.holdMs);
  const durationMs = Number(candidate.durationMs);
  const steps = Number(candidate.steps);
  const nth = Number(candidate.nth);
  const targetTabId = sanitizeOptionalInteger(candidate.targetTabId);
  const resolvedTargetTabId = sanitizeOptionalInteger(candidate.resolvedTargetTabId);
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const fromX = Number(candidate.fromX);
  const fromY = Number(candidate.fromY);
  const toX = Number(candidate.toX);
  const toY = Number(candidate.toY);
  const clipRect = sanitizeClipRect(candidate.clipRect);
  const waypoints = sanitizeWaypoints(candidate.waypoints);
  const files = sanitizeFileList(candidate.files);
  const sequenceSteps = Array.isArray(candidate.steps) ? cloneValue(candidate.steps) : null;
  const hasTarget =
    Number.isInteger(targetTabId) ||
    (typeof targetUrl === "string" && targetUrl.length > 0) ||
    (typeof targetUrlContains === "string" && targetUrlContains.length > 0);

  if (!hasTarget && type !== "navigate") {
    throw new Error("Browser commands must include targetTabId, targetUrl, or targetUrlContains.");
  }
  if (type === "navigate" && !navigationUrl) {
    throw new Error("Browser navigate commands require a navigationUrl.");
  }

  return {
    type,
    selector,
    selectorPath,
    label,
    text,
    value,
    expression,
    key,
    button,
    kind,
    role,
    within,
    scope,
    targetUrl,
    targetUrlContains,
    navigationUrl,
    filename,
    filenameContains,
    downloadUrlContains,
    targetTabId,
    resolvedTargetTabId,
    nth: Number.isFinite(nth) && nth >= 1 ? Math.round(nth) : null,
    exactText: candidate.exactText === true,
    x: Number.isFinite(x) ? Math.max(0, Math.round(x)) : null,
    y: Number.isFinite(y) ? Math.max(0, Math.round(y)) : null,
    fromX: Number.isFinite(fromX) ? Math.max(0, Math.round(fromX)) : null,
    fromY: Number.isFinite(fromY) ? Math.max(0, Math.round(fromY)) : null,
    toX: Number.isFinite(toX) ? Math.max(0, Math.round(toX)) : null,
    toY: Number.isFinite(toY) ? Math.max(0, Math.round(toY)) : null,
    waypoints,
    files,
    steps: sequenceSteps ?? (Number.isFinite(steps) && steps >= 1 ? Math.round(steps) : null),
    clipRect,
    focusTabFirst: candidate.focusTabFirst !== false,
    restorePreviousActiveTab: candidate.restorePreviousActiveTab === true,
    newTab: candidate.newTab === true,
    active: candidate.active !== false,
    bypassCache: candidate.bypassCache === true,
    refreshBeforeCapture: candidate.refreshBeforeCapture === true,
    fps:
      Number.isFinite(fps) && fps >= 1
        ? Math.min(2, Math.round(fps))
        : null,
    speedMultiplier:
      Number.isFinite(speedMultiplier) && speedMultiplier > 0
        ? Math.min(8, Math.max(0.25, speedMultiplier))
        : null,
    captureMs:
      Number.isFinite(captureMs) && captureMs >= 0
        ? Math.min(30_000, Math.round(captureMs))
        : null,
    durationMs:
      Number.isFinite(durationMs) && durationMs >= 0
        ? Math.min(10_000, Math.round(durationMs))
        : null,
    shiftKey: candidate.shiftKey === true,
    altKey: candidate.altKey === true,
    ctrlKey: candidate.ctrlKey === true,
    metaKey: candidate.metaKey === true,
    postActionDelayMs:
      Number.isFinite(postActionDelayMs) && postActionDelayMs >= 0
        ? Math.min(10_000, Math.round(postActionDelayMs))
        : null,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.min(120_000, Math.round(timeoutMs))
        : null,
    holdMs:
      Number.isFinite(holdMs) && holdMs >= 0
        ? Math.min(10_000, Math.round(holdMs))
        : null,
  };
}

export function sanitizeHelloPayload(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Browser socket hello payload must be an object.");
  }

  const role = sanitizeRole(candidate.role);
  if (!role) {
    throw new Error("Browser socket hello role is required.");
  }

  return {
    role,
    extensionId: sanitizeString(candidate.extensionId, 128),
    extensionName: sanitizeString(candidate.extensionName, 128),
    extensionVersion: sanitizeString(candidate.extensionVersion, 64),
    browserName: sanitizeString(candidate.browserName, 64) ?? "chrome",
  };
}

export function sanitizePresencePayload(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Browser socket presence payload must be an object.");
  }

  const lastSeenAt = sanitizeString(candidate.lastSeenAt, 64) ?? nowIso();
  const tabId = Number.isInteger(candidate.activeTabId) ? candidate.activeTabId : null;

  return {
    source: sanitizeString(candidate.source, 128) ?? "websocket:presence",
    page: sanitizePage(candidate.page),
    activeTabId: tabId,
    visible: candidate.visible === true,
    focused: candidate.focused === true,
    capabilities: sanitizeCapabilities(candidate.capabilities),
    lastSeenAt,
  };
}

export function sanitizeCommandEnvelope(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Browser socket command request must be an object.");
  }

  const requestId = sanitizeRequestId(candidate.requestId) ?? createCommandId();
  const command = sanitizeCommandPayload(candidate.command ?? candidate);

  return {
    requestId,
    command,
  };
}

export function sanitizeCommandResultPayload(candidate, ok) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Browser socket command result must be an object.");
  }

  const requestId = sanitizeRequestId(candidate.requestId);
  if (!requestId) {
    throw new Error("Browser socket command result requestId is required.");
  }

  return ok
    ? {
        requestId,
        result: cloneValue(candidate.result ?? null),
      }
    : {
        requestId,
        error: sanitizeString(candidate.error, MAX_TEXT_LENGTH) ?? "Browser command failed.",
      };
}

export function createCommandId() {
  return `browser-command-${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function toTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isFreshSession(session) {
  if (!session?.lastSeenAt) {
    return false;
  }

  return Date.now() - toTimestamp(session.lastSeenAt) <= STALE_AFTER_MS;
}

export function compareSessions(a, b) {
  return (
    Number(b?.focused === true) - Number(a?.focused === true) ||
    Number(b?.visible === true) - Number(a?.visible === true) ||
    toTimestamp(b?.lastSeenAt) - toTimestamp(a?.lastSeenAt) ||
    Number(b?.tabId ?? -1) - Number(a?.tabId ?? -1)
  );
}

export function compareConnections(a, b) {
  return (
    toTimestamp(b?.lastSeenAt) - toTimestamp(a?.lastSeenAt) ||
    toTimestamp(b?.updatedAt) - toTimestamp(a?.updatedAt) ||
    String(b?.connectionId ?? "").localeCompare(String(a?.connectionId ?? ""))
  );
}

export function createDisconnectedSummary() {
  return {
    connected: false,
    stale: true,
    lastSeenAt: null,
    lastSeenAgoMs: null,
    extensionId: null,
    extensionName: null,
    extensionVersion: null,
    browserName: null,
    activeTabId: null,
    page: null,
    capabilities: [],
    visible: false,
    focused: false,
    tabCount: 0,
    tabs: [],
    pendingCommandCount: 0,
    claimedCommandCount: 0,
    message:
      "No active Kuma Picker browser session is available. Keep the target page open with the extension loaded.",
  };
}

export function doesCommandMatchClaimant(command, claimant = {}) {
  const claimantTabId = Number.isInteger(claimant.tabId) ? claimant.tabId : null;
  const claimantUrl = sanitizeString(claimant.url, 2_000);
  const claimantVisible = claimant.visible === true;
  const claimantFocused = claimant.focused === true;

  if (Number.isInteger(command.targetTabId) && claimantTabId !== command.targetTabId) {
    return false;
  }

  if (command.targetUrl && claimantUrl !== command.targetUrl) {
    return false;
  }

  if (command.targetUrlContains && !claimantUrl?.includes(command.targetUrlContains)) {
    return false;
  }

  if (command.type === "screenshot" || command.type === "record-start") {
    return claimantVisible && claimantFocused;
  }

  if (command.targetTabId || command.targetUrl || command.targetUrlContains) {
    return true;
  }

  return claimantVisible && claimantFocused;
}

export function createSocketEnvelope(type, extra = {}) {
  return {
    type,
    ...extra,
  };
}
