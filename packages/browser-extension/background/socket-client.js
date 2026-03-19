const {
  createDaemonSocketUrl,
} = KumaPickerExtensionShared;

const SOCKET_RECONNECT_BASE_DELAY_MS = 1_000;
const SOCKET_RECONNECT_MAX_DELAY_MS = 10_000;
const SOCKET_PROBE_TIMEOUT_MS = 1_500;

let daemonSocket = null;
let daemonSocketUrl = null;
let daemonTransportUrl = null;
let queuedPresenceUpdate = null;
let reconnectDelayMs = SOCKET_RECONNECT_BASE_DELAY_MS;
let reconnectTimer = null;
let lastSocketStatus = "idle";
let lastSocketError = null;
let lastSocketErrorAt = null;

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

function flushQueuedPresenceUpdate() {
  if (!queuedPresenceUpdate || !isDaemonSocketOpen()) {
    return;
  }

  daemonSocket.send(JSON.stringify(queuedPresenceUpdate));
  queuedPresenceUpdate = null;
}

function sendDaemonSocketMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.type === "presence.update" && !isDaemonSocketOpen()) {
    queuedPresenceUpdate = payload;
    return false;
  }

  if (!isDaemonSocketOpen()) {
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

      switch (message?.type) {
        case "hello":
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
        default:
          return;
      }
    })();
  });

  socket.addEventListener("close", () => {
    if (daemonSocket === socket) {
      daemonSocket = null;
      daemonSocketUrl = null;
      if (lastSocketStatus !== "error") {
        lastSocketStatus = "disconnected";
        void reportSocketDiagnostics(daemonUrl, "websocket:close");
      }
      scheduleDaemonSocketReconnect(daemonUrl);
    }
  });

  socket.addEventListener("error", () => {
    if (daemonSocket === socket) {
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
