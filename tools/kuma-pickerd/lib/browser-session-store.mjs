import {
  cloneValue,
  compareConnections,
  compareSessions,
  createDisconnectedSummary,
  createSocketEnvelope,
  doesCommandMatchClaimant,
  isFreshSession,
  nowIso,
  sanitizeCommandEnvelope,
  sanitizeCommandResultPayload,
  sanitizeHelloPayload,
  sanitizePresencePayload,
  sanitizeString,
  toTimestamp,
} from "./browser-session-store-shared.mjs";

const COMMAND_RECONNECT_GRACE_BUFFER_MS = 5_000;
const COMMAND_RECONNECT_GRACE_MAX_MS = 300_000;

export class BrowserSessionStore {
  constructor() {
    this.metadata = null;
    this.sessions = new Map();
    this.browserConnections = new Map();
    this.controllerConnections = new Map();
    this.inFlightCommands = new Map();
  }

  pruneExpiredInFlightCommands() {
    const now = Date.now();

    for (const [requestId, request] of [...this.inFlightCommands.entries()]) {
      if (request.browserConnectionId != null || !request.reconnectDeadlineAt) {
        continue;
      }

      if (toTimestamp(request.reconnectDeadlineAt) > now) {
        continue;
      }

      const controller = this.controllerConnections.get(request.controllerConnectionId);
      controller?.send(
        createSocketEnvelope("command.error", {
          requestId,
          error: "The target browser connection disconnected before the command completed and did not reconnect in time.",
        }),
      );
      this.inFlightCommands.delete(requestId);
    }
  }

  computeReconnectDeadline(command) {
    const requestedTimeoutMs =
      typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) && command.timeoutMs > 0
        ? command.timeoutMs
        : 15_000;
    return new Date(
      Date.now() + Math.min(requestedTimeoutMs + COMMAND_RECONNECT_GRACE_BUFFER_MS, COMMAND_RECONNECT_GRACE_MAX_MS),
    ).toISOString();
  }

  reclaimInFlightCommands(connectionId, extensionId) {
    if (!extensionId) {
      return;
    }

    const now = Date.now();
    for (const request of this.inFlightCommands.values()) {
      if (request.browserConnectionId != null) {
        continue;
      }
      if (request.browserExtensionId !== extensionId) {
        continue;
      }
      if (request.reconnectDeadlineAt && toTimestamp(request.reconnectDeadlineAt) <= now) {
        continue;
      }

      request.browserConnectionId = connectionId;
      request.disconnectedAt = null;
      request.reconnectDeadlineAt = null;
    }
  }

  registerHello(connectionId, payload, send) {
    this.pruneExpiredInFlightCommands();
    const hello = sanitizeHelloPayload(payload);
    const record = {
      connectionId,
      send,
      role: hello.role,
      extensionId: hello.extensionId,
      extensionName: hello.extensionName ?? "Kuma Picker Bridge",
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
      this.reclaimInFlightCommands(connectionId, record.extensionId);
    } else {
      this.controllerConnections.set(connectionId, record);
    }

    return cloneValue(record);
  }

  recordBrowserPresence(connectionId, payload) {
    this.pruneExpiredInFlightCommands();
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
      browserUserAgent: presence.browserUserAgent,
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
    this.pruneExpiredInFlightCommands();
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

      throw new Error(
        "No active browser connection is available. Refresh the target page once so the extension can send a fresh presence heartbeat.",
      );
    }

    const command = {
      ...envelope.command,
      resolvedTargetTabId: Number.isInteger(targetSession?.tabId) ? targetSession.tabId : envelope.command.resolvedTargetTabId,
    };

    this.inFlightCommands.set(envelope.requestId, {
      requestId: envelope.requestId,
      controllerConnectionId: connectionId,
      browserConnectionId: browserConnection.connectionId,
      browserExtensionId: browserConnection.extensionId ?? null,
      createdAt: nowIso(),
      command,
      disconnectedAt: null,
      reconnectDeadlineAt: null,
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
    this.pruneExpiredInFlightCommands();
    const result = sanitizeCommandResultPayload(payload, true);
    return this.completeBrowserEnvelope(connectionId, result.requestId, {
      type: "command.result",
      requestId: result.requestId,
      result: result.result,
    });
  }

  failBrowserCommand(connectionId, payload) {
    this.pruneExpiredInFlightCommands();
    const result = sanitizeCommandResultPayload(payload, false);
    return this.completeBrowserEnvelope(connectionId, result.requestId, {
      type: "command.error",
      requestId: result.requestId,
      error: result.error,
    });
  }

  disconnect(connectionId) {
    this.pruneExpiredInFlightCommands();
    this.controllerConnections.delete(connectionId);

    if (this.browserConnections.delete(connectionId)) {
      for (const [sessionKey, session] of [...this.sessions.entries()]) {
        if (session.connectionId === connectionId) {
          this.sessions.delete(sessionKey);
        }
      }

      for (const [requestId, request] of [...this.inFlightCommands.entries()]) {
        if (request.browserConnectionId === connectionId) {
          if (request.browserExtensionId) {
            request.browserConnectionId = null;
            request.disconnectedAt = nowIso();
            request.reconnectDeadlineAt = this.computeReconnectDeadline(request.command);
            continue;
          }

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
    this.pruneExpiredInFlightCommands();
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
    const pendingCommandCount = 0;
    const claimedCommandCount = this.inFlightCommands.size;
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
      browserUserAgent: referenceSession.browserUserAgent ?? null,
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
            ? "Active Kuma Picker browser sessions are ready across multiple tabs."
            : "Active Kuma Picker browser session is ready."
          : "The last Kuma Picker browser session update is stale. Reconnect the extension or refocus the target tab.",
    };
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
    this.pruneExpiredInFlightCommands();
    const request = this.inFlightCommands.get(requestId);
    if (!request) {
      throw new Error(`Unknown browser command request: ${requestId}`);
    }

    if (request.browserConnectionId !== connectionId) {
      const browserConnection = this.browserConnections.get(connectionId);
      const canReconnectComplete =
        request.browserConnectionId == null &&
        browserConnection?.extensionId &&
        browserConnection.extensionId === request.browserExtensionId;
      if (!canReconnectComplete) {
        throw new Error("Only the claimed browser connection can complete this command.");
      }

      request.browserConnectionId = connectionId;
      request.disconnectedAt = null;
      request.reconnectDeadlineAt = null;
    }

    const controller = this.controllerConnections.get(request.controllerConnectionId);
    controller?.send(createSocketEnvelope(envelope.type, envelope));
    this.inFlightCommands.delete(requestId);
    return cloneValue(envelope);
  }
}
