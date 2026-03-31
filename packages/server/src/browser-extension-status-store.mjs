import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveKumaPickerStateDir } from "./state-home.mjs";

export const EXTENSION_STATUS_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function sanitizeString(value, maxLength = 240) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function sanitizeUrl(value) {
  return sanitizeString(value, 2000);
}

function sanitizeExtensionId(value) {
  const candidate = sanitizeString(value, 128);
  return candidate && /^[a-z]{8,64}$/.test(candidate) ? candidate : null;
}

function sanitizeSource(value) {
  return sanitizeString(value, 120);
}

function normalizePage(page) {
  const candidate = page && typeof page === "object" ? page : null;
  if (!candidate) {
    return null;
  }

  const url = sanitizeUrl(candidate.url);
  const pathname = sanitizeString(candidate.pathname, 1000);
  const title = sanitizeString(candidate.title, 240);

  if (!url && !pathname && !title) {
    return null;
  }

  return {
    url,
    pathname,
    title,
  };
}

function normalizeTimestamp(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return fallback;
}

function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "at an unknown time";
  }

  if (ageMs < 1_000) {
    return "just now";
  }

  if (ageMs < 60_000) {
    return `${Math.round(ageMs / 1_000)}s ago`;
  }

  if (ageMs < 3_600_000) {
    return `${Math.round(ageMs / 60_000)}m ago`;
  }

  return `${Math.round(ageMs / 3_600_000)}h ago`;
}

function normalizeExtensionStatus(status, defaults = {}) {
  const candidate = status && typeof status === "object" ? status : {};
  const now = new Date().toISOString();
  const extensionId = sanitizeExtensionId(candidate.extensionId) ?? sanitizeExtensionId(defaults.extensionId);

  if (!extensionId) {
    throw new Error("Missing required field: extensionId");
  }

  return {
    version: 1,
    extensionId,
    extensionName: sanitizeString(candidate.extensionName, 120) ?? sanitizeString(defaults.extensionName, 120) ?? "Kuma Picker Bridge",
    extensionVersion: sanitizeString(candidate.extensionVersion, 32) ?? sanitizeString(defaults.extensionVersion, 32) ?? "0.0.0",
    browserName: sanitizeString(candidate.browserName, 32) ?? sanitizeString(defaults.browserName, 32) ?? "chrome",
    browserTransport:
      sanitizeString(candidate.browserTransport, 32) ?? sanitizeString(defaults.browserTransport, 32) ?? "unknown",
    socketConnected:
      typeof candidate.socketConnected === "boolean"
        ? candidate.socketConnected
        : typeof defaults.socketConnected === "boolean"
          ? defaults.socketConnected
          : false,
    lastSocketError:
      candidate.lastSocketError === null
        ? null
        : sanitizeString(candidate.lastSocketError, 512) ?? sanitizeString(defaults.lastSocketError, 512),
    lastSocketErrorAt:
      candidate.lastSocketErrorAt === null
        ? null
        : normalizeTimestamp(candidate.lastSocketErrorAt, defaults.lastSocketErrorAt ?? null),
    firstSeenAt: normalizeTimestamp(defaults.firstSeenAt, normalizeTimestamp(candidate.firstSeenAt, now)),
    lastSeenAt: normalizeTimestamp(candidate.lastSeenAt, now),
    lastSource: sanitizeSource(candidate.lastSource ?? candidate.source) ?? sanitizeSource(defaults.lastSource) ?? "unknown",
    lastPage: normalizePage(candidate.lastPage ?? candidate.page) ?? normalizePage(defaults.lastPage),
  };
}

function buildSummary(status, now = Date.now(), staleAfterMs = EXTENSION_STATUS_ACTIVE_WINDOW_MS) {
  if (!status) {
    return {
      version: 1,
      detected: false,
      active: false,
      status: "unseen",
      staleAfterMs,
      lastSeenAt: null,
      lastSeenAgoMs: null,
      firstSeenAt: null,
      extensionId: null,
      extensionName: null,
      extensionVersion: null,
      browserName: null,
      browserTransport: "unknown",
      socketConnected: false,
      lastSocketError: null,
      lastSocketErrorAt: null,
      lastSource: null,
      lastPage: null,
      message:
        "No Kuma Picker browser extension presence has been reported yet. Open a regular website tab or the extension popup after loading the unpacked extension.",
    };
  }

  const lastSeenMs = Date.parse(status.lastSeenAt);
  const lastSeenAgoMs = Number.isFinite(lastSeenMs) ? Math.max(0, now - lastSeenMs) : null;
  const active = Number.isFinite(lastSeenAgoMs) ? lastSeenAgoMs <= staleAfterMs : false;

  return {
    version: 1,
    detected: true,
    active,
    status: active ? "active" : "seen",
    staleAfterMs,
    firstSeenAt: status.firstSeenAt,
    lastSeenAt: status.lastSeenAt,
    lastSeenAgoMs,
    extensionId: status.extensionId,
    extensionName: status.extensionName,
    extensionVersion: status.extensionVersion,
    browserName: status.browserName,
    browserTransport: status.browserTransport,
    socketConnected: status.socketConnected === true,
    lastSocketError: status.lastSocketError ?? null,
    lastSocketErrorAt: status.lastSocketErrorAt ?? null,
    lastSource: status.lastSource,
    lastPage: status.lastPage,
    message: active
      ? `Kuma Picker browser extension presence seen ${formatAge(lastSeenAgoMs)}.`
      : `Kuma Picker browser extension was last seen ${formatAge(lastSeenAgoMs)}.`,
  };
}

export class BrowserExtensionStatusStore {
  constructor(root) {
    this.root = resolve(root);
    this.statusPath = resolve(resolveKumaPickerStateDir(), "browser-extension-status.json");
  }

  ensureDirectory() {
    mkdirSync(dirname(this.statusPath), { recursive: true });
  }

  read() {
    try {
      return normalizeExtensionStatus(JSON.parse(readFileSync(this.statusPath, "utf8")));
    } catch {
      return null;
    }
  }

  write(status) {
    this.ensureDirectory();
    const existing = this.read();
    const normalized = normalizeExtensionStatus(status, existing ?? {});
    writeFileSync(this.statusPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }

  readSummary(options = {}) {
    const now = typeof options.now === "number" && Number.isFinite(options.now) ? options.now : Date.now();
    const staleAfterMs =
      typeof options.staleAfterMs === "number" && Number.isFinite(options.staleAfterMs)
        ? options.staleAfterMs
        : EXTENSION_STATUS_ACTIVE_WINDOW_MS;
    return buildSummary(this.read(), now, staleAfterMs);
  }
}
