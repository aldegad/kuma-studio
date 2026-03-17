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

function sanitizeRequestId(value) {
  const candidate = sanitizeString(value, 128);
  return candidate && /^[a-zA-Z0-9:_-]{6,128}$/.test(candidate) ? candidate : null;
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
  const label = sanitizeString(candidate.label, 512);
  const text = sanitizeString(candidate.text, 512);
  const value = typeof candidate.value === "string" ? candidate.value.slice(0, 4_000) : null;
  const key = sanitizeString(candidate.key, 64);
  const kind = sanitizeString(candidate.kind, 64);
  const scope = sanitizeString(candidate.scope, 32);
  const targetUrl = sanitizeString(candidate.targetUrl, 2_000);
  const targetUrlContains = sanitizeString(candidate.targetUrlContains, 1_000);
  const postActionDelayMs = Number(candidate.postActionDelayMs);
  const timeoutMs = Number(candidate.timeoutMs);
  const targetTabId = sanitizeOptionalInteger(candidate.targetTabId);
  const resolvedTargetTabId = sanitizeOptionalInteger(candidate.resolvedTargetTabId);
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const hasTarget =
    Number.isInteger(targetTabId) ||
    (typeof targetUrl === "string" && targetUrl.length > 0) ||
    (typeof targetUrlContains === "string" && targetUrlContains.length > 0);

  if (!hasTarget) {
    throw new Error("Browser commands must include targetTabId, targetUrl, or targetUrlContains.");
  }

  return {
    type,
    selector,
    selectorPath,
    label,
    text,
    value,
    key,
    kind,
    scope,
    targetUrl,
    targetUrlContains,
    targetTabId,
    resolvedTargetTabId,
    x: Number.isFinite(x) ? Math.max(0, Math.round(x)) : null,
    y: Number.isFinite(y) ? Math.max(0, Math.round(y)) : null,
    shiftKey: candidate.shiftKey === true,
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

function sanitizeHelloPayload(candidate) {
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

function sanitizePresencePayload(candidate) {
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

function sanitizeCommandEnvelope(candidate) {
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

function sanitizeCommandResultPayload(candidate, ok) {
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

function createCommandId() {
  return `browser-command-${randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshSession(session) {
  if (!session?.lastSeenAt) {
    return false;
  }

  return Date.now() - toTimestamp(session.lastSeenAt) <= STALE_AFTER_MS;
}

function compareSessions(a, b) {
  return (
    Number(b?.focused === true) - Number(a?.focused === true) ||
    Number(b?.visible === true) - Number(a?.visible === true) ||
    toTimestamp(b?.lastSeenAt) - toTimestamp(a?.lastSeenAt) ||
    Number(b?.tabId ?? -1) - Number(a?.tabId ?? -1)
  );
}

function compareConnections(a, b) {
  return (
    toTimestamp(b?.lastSeenAt) - toTimestamp(a?.lastSeenAt) ||
    toTimestamp(b?.updatedAt) - toTimestamp(a?.updatedAt) ||
    String(b?.connectionId ?? "").localeCompare(String(a?.connectionId ?? ""))
  );
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
    visible: false,
    focused: false,
    tabCount: 0,
    tabs: [],
    pendingCommandCount: 0,
    claimedCommandCount: 0,
    message:
      "No active Agent Picker browser session is available. Keep the target page open with the extension loaded.",
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

function createSocketEnvelope(type, extra = {}) {
  return {
    type,
    ...extra,
  };
}

export class BrowserSessionStore {
  constructor() {
    this.metadata = null;
    this.sessions = new Map();
    this.commands = new Map();
    this.commandOrder = [];
    this.browserConnections = new Map();
    this.controllerConnections = new Map();
    this.inFlightCommands = new Map();
  }

  heartbeat(payload) {
    const receivedAt = nowIso();
    const page = sanitizePage(payload?.page);
    const metadata = {
      extensionId: sanitizeString(payload?.extensionId, 128),
      extensionName: sanitizeString(payload?.extensionName, 128),
      extensionVersion: sanitizeString(payload?.extensionVersion, 64),
      browserName: sanitizeString(payload?.browserName, 64) ?? "chrome",
      updatedAt: receivedAt,
    };
    const lastSeenAt = sanitizeString(payload?.lastSeenAt, 64) ?? receivedAt;
    const tabId = Number.isInteger(payload?.activeTabId) ? payload.activeTabId : null;

    this.metadata = metadata;

    if (tabId != null || page) {
      const sessionKey = tabId != null ? `tab:${tabId}` : `page:${page?.url ?? receivedAt}`;
      this.sessions.set(sessionKey, {
        ...metadata,
        connectionId: null,
        source: sanitizeString(payload?.source, 128),
        lastSeenAt,
        tabId,
        page,
        capabilities: sanitizeCapabilities(payload?.capabilities),
        visible: payload?.visible === true,
        focused: payload?.focused === true,
      });
    }

    return this.readSummary();
  }

  registerHello(connectionId, payload, send) {
    const hello = sanitizeHelloPayload(payload);
    const record = {
      connectionId,
      send,
      role: hello.role,
      extensionId: hello.extensionId,
      extensionName: hello.extensionName ?? "Agent Picker Bridge",
      extensionVersion: hello.extensionVersion ?? "0.0.0",
      browserName: hello.browserName ?? "chrome",
      updatedAt: nowIso(),
      lastSeenAt: nowIso(),
    };

    if (hello.role === "browser") {
      this.browserConnections.set(connectionId, record);
      this.metadata = {
        extensionId: record.extensionId,
        extensionName: record.extensionName,
        extensionVersion: record.extensionVersion,
        browserName: record.browserName,
        updatedAt: record.updatedAt,
      };
    } else {
      this.controllerConnections.set(connectionId, record);
    }

    return cloneValue(record);
  }

  recordBrowserPresence(connectionId, payload) {
    const connection = this.browserConnections.get(connectionId);
    if (!connection) {
      throw new Error("Browser presence requires an active browser hello.");
    }

    const presence = sanitizePresencePayload(payload);
    const sessionKey =
      presence.activeTabId != null ? `tab:${presence.activeTabId}` : `page:${presence.page?.url ?? connectionId}`;

    connection.updatedAt = nowIso();
    connection.lastSeenAt = presence.lastSeenAt;
    this.metadata = {
      extensionId: connection.extensionId,
      extensionName: connection.extensionName,
      extensionVersion: connection.extensionVersion,
      browserName: connection.browserName,
      updatedAt: connection.updatedAt,
    };

    this.sessions.set(sessionKey, {
      connectionId,
      extensionId: connection.extensionId,
      extensionName: connection.extensionName,
      extensionVersion: connection.extensionVersion,
      browserName: connection.browserName,
      updatedAt: connection.updatedAt,
      source: presence.source,
      lastSeenAt: presence.lastSeenAt,
      tabId: presence.activeTabId,
      page: presence.page,
      capabilities: presence.capabilities,
      visible: presence.visible,
      focused: presence.focused,
    });

    return {
      summary: this.readSummary(),
        extensionStatus: {
          extensionId: connection.extensionId,
          extensionName: connection.extensionName,
          extensionVersion: connection.extensionVersion,
          browserName: connection.browserName,
          browserTransport: "websocket",
          socketConnected: true,
          lastSocketError: null,
          lastSocketErrorAt: null,
          source: presence.source,
          page: presence.page,
          lastSeenAt: presence.lastSeenAt,
      },
    };
  }

  dispatchControllerCommand(connectionId, payload) {
    const controller = this.controllerConnections.get(connectionId);
    if (!controller) {
      throw new Error("Browser command requests require a controller hello.");
    }

    const envelope = sanitizeCommandEnvelope(payload);
    const targetSession = this.findMatchingSession(envelope.command);
    const browserConnection =
      (targetSession?.connectionId ? this.browserConnections.get(targetSession.connectionId) : null) ??
      this.findFallbackBrowserConnection();
    if (!browserConnection) {
      if (this.browserConnections.size > 1) {
        throw new Error(
          "No live browser session matches the requested tab target, and multiple browser bridges are connected. Refresh the target page and try again.",
        );
      }

      throw new Error("No active browser connection is available.");
    }

    const command = {
      ...envelope.command,
      resolvedTargetTabId: Number.isInteger(targetSession?.tabId) ? targetSession.tabId : envelope.command.resolvedTargetTabId,
    };

    this.inFlightCommands.set(envelope.requestId, {
      requestId: envelope.requestId,
      controllerConnectionId: connectionId,
      browserConnectionId: browserConnection.connectionId,
      createdAt: nowIso(),
      command,
    });

    controller.send(
      createSocketEnvelope("command.accepted", {
        requestId: envelope.requestId,
      }),
    );
    browserConnection.send(
      createSocketEnvelope("command.request", {
        requestId: envelope.requestId,
        command,
      }),
    );

    return {
      requestId: envelope.requestId,
      command,
    };
  }

  completeBrowserCommand(connectionId, payload) {
    const result = sanitizeCommandResultPayload(payload, true);
    return this.completeBrowserEnvelope(connectionId, result.requestId, {
      type: "command.result",
      requestId: result.requestId,
      result: result.result,
    });
  }

  failBrowserCommand(connectionId, payload) {
    const result = sanitizeCommandResultPayload(payload, false);
    return this.completeBrowserEnvelope(connectionId, result.requestId, {
      type: "command.error",
      requestId: result.requestId,
      error: result.error,
    });
  }

  disconnect(connectionId) {
    this.controllerConnections.delete(connectionId);

    if (this.browserConnections.delete(connectionId)) {
      for (const [sessionKey, session] of [...this.sessions.entries()]) {
        if (session.connectionId === connectionId) {
          this.sessions.delete(sessionKey);
        }
      }

      for (const [requestId, request] of [...this.inFlightCommands.entries()]) {
        if (request.browserConnectionId === connectionId) {
          const controller = this.controllerConnections.get(request.controllerConnectionId);
          controller?.send(
            createSocketEnvelope("command.error", {
              requestId,
              error: "The target browser connection disconnected before the command completed.",
            }),
          );
          this.inFlightCommands.delete(requestId);
        }
      }
      return;
    }

    for (const [requestId, request] of [...this.inFlightCommands.entries()]) {
      if (request.controllerConnectionId === connectionId) {
        this.inFlightCommands.delete(requestId);
      }
    }
  }

  readSummary() {
    const sessions = [...this.sessions.values()];
    const freshSessions = sessions.filter(isFreshSession).sort(compareSessions);
    const primarySession = freshSessions[0] ?? null;

    if (!primarySession && !this.metadata) {
      return createDisconnectedSummary();
    }

    const referenceSession =
      primarySession ??
      sessions.sort(compareSessions)[0] ?? {
        ...this.metadata,
        lastSeenAt: this.metadata?.updatedAt ?? null,
        tabId: null,
        page: null,
        capabilities: [],
        visible: false,
        focused: false,
      };
    const lastSeenAt = sanitizeString(referenceSession.lastSeenAt, 64) ?? referenceSession.updatedAt;
    const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
    const lastSeenAgoMs = Number.isFinite(lastSeenMs) ? Math.max(0, Date.now() - lastSeenMs) : null;
    const stale = !primarySession;
    const pendingCommandCount = this.commandOrder.filter(
      (commandId) => this.commands.get(commandId)?.status === "pending",
    ).length;
    const claimedCommandCount =
      this.commandOrder.filter((commandId) => this.commands.get(commandId)?.status === "claimed").length +
      this.inFlightCommands.size;
    const tabSummaries = freshSessions.map((session) => ({
      tabId: session.tabId,
      page: cloneValue(session.page),
      lastSeenAt: session.lastSeenAt,
      visible: session.visible === true,
      focused: session.focused === true,
    }));

    return {
      connected: !stale && !!primarySession,
      stale,
      lastSeenAt,
      lastSeenAgoMs,
      extensionId: referenceSession.extensionId,
      extensionName: referenceSession.extensionName,
      extensionVersion: referenceSession.extensionVersion,
      browserName: referenceSession.browserName,
      activeTabId: referenceSession.tabId,
      page: cloneValue(referenceSession.page),
      capabilities: [...(referenceSession.capabilities ?? [])],
      visible: referenceSession.visible === true,
      focused: referenceSession.focused === true,
      tabCount: freshSessions.length,
      tabs: tabSummaries,
      pendingCommandCount,
      claimedCommandCount,
      message:
        !stale && primarySession
          ? freshSessions.length > 1
            ? "Active Agent Picker browser sessions are ready across multiple tabs."
            : "Active Agent Picker browser session is ready."
          : "The last Agent Picker browser session update is stale. Reconnect the extension or refocus the target tab.",
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
      label: sanitized.label,
      text: sanitized.text,
      value: sanitized.value,
      key: sanitized.key,
      kind: sanitized.kind,
      scope: sanitized.scope,
      targetTabId: sanitized.targetTabId,
      targetUrl: sanitized.targetUrl,
      targetUrlContains: sanitized.targetUrlContains,
      x: sanitized.x,
      y: sanitized.y,
      shiftKey: sanitized.shiftKey,
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

  findMatchingSession(command) {
    const sessions = [...this.sessions.values()].filter((session) => isFreshSession(session));
    const matching = sessions.filter((session) =>
      doesCommandMatchClaimant(command, {
        tabId: session.tabId,
        url: session.page?.url,
        visible: session.visible,
        focused: session.focused,
      }),
    );

    return matching.sort(compareSessions)[0] ?? null;
  }

  findFallbackBrowserConnection() {
    if (this.browserConnections.size !== 1) {
      return null;
    }

    return [...this.browserConnections.values()].sort(compareConnections)[0] ?? null;
  }

  completeBrowserEnvelope(connectionId, requestId, envelope) {
    const request = this.inFlightCommands.get(requestId);
    if (!request) {
      throw new Error(`Unknown browser command request: ${requestId}`);
    }

    if (request.browserConnectionId !== connectionId) {
      throw new Error("Only the claimed browser connection can complete this command.");
    }

    const controller = this.controllerConnections.get(request.controllerConnectionId);
    controller?.send(createSocketEnvelope(envelope.type, envelope));
    this.inFlightCommands.delete(requestId);
    return cloneValue(envelope);
  }
}
