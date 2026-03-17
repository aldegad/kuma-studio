import { randomUUID } from "node:crypto";

const STALE_AFTER_MS = 15_000;
const MAX_COMMANDS = 100;
const MAX_CAPABILITIES = 16;
const MAX_TEXT_LENGTH = 2_000;

function sanitizeString(value, maxLength = 256) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function sanitizePage(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return {
    url: sanitizeString(candidate.url, 2_000),
    pathname: sanitizeString(candidate.pathname, 1_000),
    title: sanitizeString(candidate.title, 512),
  };
}

function sanitizeCapabilities(candidate) {
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

function sanitizeCommandPayload(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Browser command payload must be an object.");
  }

  const type = sanitizeString(candidate.type, 64);
  if (!type) {
    throw new Error("Browser command type is required.");
  }

  const selector = sanitizeString(candidate.selector, 1_200);
  const selectorPath = sanitizeString(candidate.selectorPath, 2_000);
  const text = sanitizeString(candidate.text, 512);
  const file = sanitizeString(candidate.file, 2_000);
  const targetUrl = sanitizeString(candidate.targetUrl, 2_000);
  const targetUrlContains = sanitizeString(candidate.targetUrlContains, 1_000);
  const postActionDelayMs = Number(candidate.postActionDelayMs);
  const timeoutMs = Number(candidate.timeoutMs);
  const targetTabId = Number(candidate.targetTabId);

  return {
    type,
    selector,
    selectorPath,
    text,
    file,
    targetUrl,
    targetUrlContains,
    targetTabId: Number.isInteger(targetTabId) ? targetTabId : null,
    postActionDelayMs:
      Number.isFinite(postActionDelayMs) && postActionDelayMs >= 0
        ? Math.min(10_000, Math.round(postActionDelayMs))
        : null,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.min(120_000, Math.round(timeoutMs))
        : null,
  };
}

function createCommandId() {
  return `browser-command-${randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDisconnectedSummary() {
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
    pendingCommandCount: 0,
    claimedCommandCount: 0,
    message:
      "No active Agent Picker browser session is available. Keep the target page open in the active tab with the extension loaded.",
  };
}

function doesCommandMatchClaimant(command, claimant = {}) {
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

  if (command.type === "screenshot") {
    return claimantVisible && claimantFocused;
  }

  if (command.targetTabId || command.targetUrl || command.targetUrlContains) {
    return true;
  }

  return claimantVisible && claimantFocused;
}

export class BrowserSessionStore {
  constructor() {
    this.session = null;
    this.commands = new Map();
    this.commandOrder = [];
  }

  heartbeat(payload) {
    const receivedAt = nowIso();
    const page = sanitizePage(payload?.page);
    const nextSession = {
      extensionId: sanitizeString(payload?.extensionId, 128),
      extensionName: sanitizeString(payload?.extensionName, 128),
      extensionVersion: sanitizeString(payload?.extensionVersion, 64),
      browserName: sanitizeString(payload?.browserName, 64) ?? "chrome",
      source: sanitizeString(payload?.source, 128),
      lastSeenAt: sanitizeString(payload?.lastSeenAt, 64) ?? receivedAt,
      activeTabId: Number.isInteger(payload?.activeTabId) ? payload.activeTabId : null,
      page,
      capabilities: sanitizeCapabilities(payload?.capabilities),
      updatedAt: receivedAt,
    };

    this.session = nextSession;
    return this.readSummary();
  }

  readSummary() {
    if (!this.session) {
      return createDisconnectedSummary();
    }

    const lastSeenAt = sanitizeString(this.session.lastSeenAt, 64) ?? this.session.updatedAt;
    const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
    const lastSeenAgoMs = Number.isFinite(lastSeenMs) ? Math.max(0, Date.now() - lastSeenMs) : null;
    const stale = lastSeenAgoMs == null ? true : lastSeenAgoMs > STALE_AFTER_MS;
    const pendingCommandCount = this.commandOrder.filter(
      (commandId) => this.commands.get(commandId)?.status === "pending",
    ).length;
    const claimedCommandCount = this.commandOrder.filter(
      (commandId) => this.commands.get(commandId)?.status === "claimed",
    ).length;

    return {
      connected: !stale,
      stale,
      lastSeenAt,
      lastSeenAgoMs,
      extensionId: this.session.extensionId,
      extensionName: this.session.extensionName,
      extensionVersion: this.session.extensionVersion,
      browserName: this.session.browserName,
      activeTabId: this.session.activeTabId,
      page: cloneValue(this.session.page),
      capabilities: [...this.session.capabilities],
      pendingCommandCount,
      claimedCommandCount,
      message: !stale
        ? "Active Agent Picker browser session is ready."
        : "The last Agent Picker browser session heartbeat is stale. Refocus the target tab to resume command polling.",
    };
  }

  enqueueCommand(payload) {
    const sanitized = sanitizeCommandPayload(payload);
    const now = nowIso();
    const command = {
      id: createCommandId(),
      createdAt: now,
      updatedAt: now,
      status: "pending",
      type: sanitized.type,
      selector: sanitized.selector,
      selectorPath: sanitized.selectorPath,
      text: sanitized.text,
      file: sanitized.file,
      targetTabId: sanitized.targetTabId,
      targetUrl: sanitized.targetUrl,
      targetUrlContains: sanitized.targetUrlContains,
      postActionDelayMs: sanitized.postActionDelayMs,
      timeoutMs: sanitized.timeoutMs,
      result: null,
      error: null,
    };

    this.commands.set(command.id, command);
    this.commandOrder.push(command.id);

    while (this.commandOrder.length > MAX_COMMANDS) {
      const staleCommandId = this.commandOrder.shift();
      if (staleCommandId) {
        this.commands.delete(staleCommandId);
      }
    }

    return cloneValue(command);
  }

  claimNextCommand(claimant = {}) {
    const commandId = this.commandOrder.find((entry) => {
      const command = this.commands.get(entry);
      return command?.status === "pending" && doesCommandMatchClaimant(command, claimant);
    });
    if (!commandId) {
      return null;
    }

    const command = this.commands.get(commandId);
    if (!command) {
      return null;
    }

    command.status = "claimed";
    command.updatedAt = nowIso();
    command.claimedAt = command.updatedAt;
    return cloneValue(command);
  }

  completeCommand(commandId, payload) {
    const command = this.commands.get(commandId);
    if (!command) {
      throw new Error(`Unknown browser command: ${commandId}`);
    }

    command.status = payload?.ok === false ? "failed" : "completed";
    command.updatedAt = nowIso();
    command.error = payload?.ok === false ? sanitizeString(payload?.error, MAX_TEXT_LENGTH) : null;
    command.result = cloneValue(payload?.result ?? null);
    return cloneValue(command);
  }

  readCommand(commandId) {
    const command = this.commands.get(commandId);
    return command ? cloneValue(command) : null;
  }
}
