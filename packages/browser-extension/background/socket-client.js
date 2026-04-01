const {
  createDaemonSocketUrl,
} = KumaPickerExtensionShared;

const SOCKET_RECONNECT_BASE_DELAY_MS = 1_000;
const SOCKET_RECONNECT_MAX_DELAY_MS = 10_000;
const SOCKET_PROBE_TIMEOUT_MS = 1_500;
const MAX_QUEUED_SOCKET_MESSAGES = 200;

let daemonSocket = null;
let daemonSocketUrl = null;
let daemonTransportUrl = null;
let queuedPresenceUpdate = null;
let queuedSocketMessages = [];
let reconnectDelayMs = SOCKET_RECONNECT_BASE_DELAY_MS;
let reconnectTimer = null;
let lastSocketStatus = "idle";
let lastSocketError = null;
let lastSocketErrorAt = null;
let daemonSocketReady = false;

function clearDaemonReconnectTimer() {
  if (reconnectTimer == null) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function getDaemonTransportMode() {
  return "websocket";
}

function isDaemonSocketOpen() {
  return Boolean(daemonSocket && daemonSocket.readyState === WebSocket.OPEN);
}

function getDaemonSocketDiagnostics() {
  return {
    browserTransport: getDaemonTransportMode(),
    socketConnected: isDaemonSocketOpen(),
    socketStatus: lastSocketStatus,
    lastSocketError,
    lastSocketErrorAt,
    daemonUrl: daemonTransportUrl,
  };
}

async function reportSocketDiagnostics(daemonUrl, source, extra = {}) {
  if (!daemonUrl) {
    return;
  }

  try {
    await reportExtensionHeartbeat(daemonUrl, {
      source,
      page: extra.page || null,
      browserTransport: getDaemonTransportMode(),
      socketConnected: isDaemonSocketOpen(),
      lastSocketError,
      lastSocketErrorAt,
    });
  } catch {
    // Ignore daemon availability issues while reporting socket diagnostics.
  }
}

function setSocketError(error, daemonUrl, source) {
  lastSocketStatus = "error";
  lastSocketError = error instanceof Error ? error.message : String(error);
  lastSocketErrorAt = new Date().toISOString();
  void reportSocketDiagnostics(daemonUrl, source);
}

function clearSocketError() {
  lastSocketError = null;
  lastSocketErrorAt = null;
}

function closeDaemonSocket(options = {}) {
  const { intentional = false } = options;
  clearDaemonReconnectTimer();
  daemonSocketReady = false;

  if (!daemonSocket) {
    if (intentional) {
      lastSocketStatus = "disconnected";
    }
    return;
  }

  const socket = daemonSocket;
  daemonSocket = null;
  daemonSocketUrl = null;

  try {
    socket.close();
  } catch {
    // Ignore close races while reconnecting.
  }

  if (intentional) {
    lastSocketStatus = "disconnected";
  }
}

function queueSocketMessage(payload) {
  queuedSocketMessages.push(payload);
  if (queuedSocketMessages.length > MAX_QUEUED_SOCKET_MESSAGES) {
    queuedSocketMessages = queuedSocketMessages.slice(-MAX_QUEUED_SOCKET_MESSAGES);
  }
}

function flushQueuedSocketMessages() {
  if (!daemonSocketReady || !isDaemonSocketOpen() || queuedSocketMessages.length === 0) {
    return;
  }

  const pending = queuedSocketMessages;
  queuedSocketMessages = [];
  for (const message of pending) {
    try {
      daemonSocket.send(JSON.stringify(message));
    } catch {
      queueSocketMessage(message);
      break;
    }
  }
}

function flushQueuedPresenceUpdate() {
  if (!queuedPresenceUpdate || !isDaemonSocketOpen() || !daemonSocketReady) {
    return;
  }

  daemonSocket.send(JSON.stringify(queuedPresenceUpdate));
  queuedPresenceUpdate = null;
}

function sendDaemonSocketMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.type === "presence.update" && (!isDaemonSocketOpen() || !daemonSocketReady)) {
    queuedPresenceUpdate = payload;
    return false;
  }

  if (!isDaemonSocketOpen() || !daemonSocketReady) {
    if (payload.type === "command.result" || payload.type === "command.error") {
      queueSocketMessage(payload);
    }
    return false;
  }

  daemonSocket.send(JSON.stringify(payload));
  return true;
}

function scheduleDaemonSocketReconnect(daemonUrl) {
  if (reconnectTimer != null) {
    return;
  }

  const nextDelay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, SOCKET_RECONNECT_MAX_DELAY_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openDaemonSocket(daemonUrl);
  }, nextDelay);
}

async function relayJobCardUpdate(message) {
  const target = message?.card?.target ?? null;
  if (!target) {
    return;
  }

  try {
    const tab = await resolveTargetTab({
      tabId: Number.isInteger(target?.tabId) ? target.tabId : undefined,
      url: typeof target?.url === "string" ? target.url : undefined,
      urlContains: typeof target?.urlContains === "string" ? target.urlContains : undefined,
    });

    await sendMessageToTab(tab.id, {
      type: "kuma-picker:job-card-event",
      id: message?.id ?? message?.card?.id ?? null,
      deleted: message?.deleted === true,
      card: message?.card ?? null,
      source: message?.source ?? "websocket",
    });
  } catch {
    // Ignore stale target-tab routing failures for best-effort overlay delivery.
  }
}

function openDaemonSocket(daemonUrl) {
  const socketUrl = createDaemonSocketUrl(daemonUrl);
  if (
    daemonSocket &&
    daemonSocketUrl === socketUrl &&
    (daemonSocket.readyState === WebSocket.CONNECTING || daemonSocket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  closeDaemonSocket();
  lastSocketStatus = "connecting";

  let socket = null;
  try {
    socket = new WebSocket(socketUrl);
  } catch (error) {
    setSocketError(error, daemonUrl, "websocket:construct-error");
    scheduleDaemonSocketReconnect(daemonUrl);
    return;
  }

  daemonSocket = socket;
  daemonSocketUrl = socketUrl;

  socket.addEventListener("open", () => {
    reconnectDelayMs = SOCKET_RECONNECT_BASE_DELAY_MS;
    lastSocketStatus = "connected";
    daemonSocketReady = false;
    clearSocketError();
    void reportSocketDiagnostics(daemonUrl, "websocket:open");
    socket.send(
      JSON.stringify({
        type: "hello",
        role: "browser",
        ...getExtensionManifestMetadata(),
      }),
    );
    flushQueuedPresenceUpdate();
  });

  socket.addEventListener("message", (event) => {
    void (async () => {
      let message = null;
      try {
        message = JSON.parse(String(event.data ?? "{}"));
      } catch {
        return;
      }

      try {
        switch (message?.type) {
          case "hello":
            daemonSocketReady = true;
            flushQueuedSocketMessages();
            flushQueuedPresenceUpdate();
            return;
          case "ping":
            sendDaemonSocketMessage({
              type: "pong",
              sentAt: new Date().toISOString(),
            });
            return;
          case "command.request":
            await handleSocketCommandRequest(daemonUrl, message);
            return;
          case "job-card.updated":
            await relayJobCardUpdate(message);
            return;
          case "extension.reload":
            chrome.runtime.reload();
            return;
          default:
            return;
        }
      } catch (err) {
        console.error("[kuma-studio] socket message handler error:", err);
      }
    })();
  });

  socket.addEventListener("close", () => {
    if (daemonSocket === socket) {
      daemonSocket = null;
      daemonSocketUrl = null;
      daemonSocketReady = false;
      if (lastSocketStatus !== "error") {
        lastSocketStatus = "disconnected";
        void reportSocketDiagnostics(daemonUrl, "websocket:close");
      }
      scheduleDaemonSocketReconnect(daemonUrl);
    }
  });

  socket.addEventListener("error", () => {
    if (daemonSocket === socket) {
      daemonSocketReady = false;
      setSocketError("The Kuma Picker WebSocket bridge failed to initialize.", daemonUrl, "websocket:error");
      try {
        socket.close();
      } catch {
        // Ignore close races on socket errors.
      }
    }
  });
}

async function waitForDaemonSocketReady(timeoutMs = SOCKET_PROBE_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const diagnostics = getDaemonSocketDiagnostics();
    if (diagnostics.socketConnected || diagnostics.lastSocketError || diagnostics.socketStatus === "disconnected") {
      return diagnostics;
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 50);
    });
  }

  return getDaemonSocketDiagnostics();
}

async function ensureDaemonTransport(daemonUrl, options = {}) {
  const normalizedDaemonUrl = KumaPickerExtensionShared.normalizeDaemonUrl(daemonUrl);
  const shouldRefresh = options.force === true || daemonTransportUrl !== normalizedDaemonUrl;

  if (shouldRefresh) {
    await fetchDaemonHealth(normalizedDaemonUrl);
    daemonTransportUrl = normalizedDaemonUrl;
  }

  openDaemonSocket(normalizedDaemonUrl);
  return getDaemonTransportMode();
}
