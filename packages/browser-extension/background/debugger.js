const DEBUGGER_PROTOCOL_VERSION = "1.3";
const DEFAULT_DEBUGGER_CAPTURE_MS = 3_000;
const MAX_DEBUGGER_EVENTS = 100;

function createDebuggerTarget(tabId) {
  return { tabId };
}

function waitForDelay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function clampDebuggerCaptureMs(value, fallback = DEFAULT_DEBUGGER_CAPTURE_MS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return Math.min(30_000, Math.round(numeric));
}

function normalizeDebuggerString(value, maxLength = 1_000) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function summarizeDebuggerValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return normalizeDebuggerString(value, 1_500) ?? "";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      if (depth >= 2) {
        return `[Array(${value.length})]`;
      }
      return value.slice(0, 8).map((entry) => summarizeDebuggerValue(entry, depth + 1, seen));
    }

    if (depth >= 2) {
      return Object.prototype.toString.call(value);
    }

    const summary = {};
    for (const [key, entry] of Object.entries(value).slice(0, 12)) {
      summary[key] = summarizeDebuggerValue(entry, depth + 1, seen);
    }
    return summary;
  }

  return String(value);
}

function pushDebuggerEntry(list, entry) {
  list.push(entry);
  if (list.length > MAX_DEBUGGER_EVENTS) {
    list.splice(0, list.length - MAX_DEBUGGER_EVENTS);
  }
}

function describeRemoteObject(remoteObject) {
  if (!remoteObject || typeof remoteObject !== "object") {
    return null;
  }

  return {
    type: normalizeDebuggerString(remoteObject.type, 64),
    subtype: normalizeDebuggerString(remoteObject.subtype, 64),
    className: normalizeDebuggerString(remoteObject.className, 128),
    description: normalizeDebuggerString(remoteObject.description, 1_000),
    value: summarizeDebuggerValue(remoteObject.value),
    unserializableValue: normalizeDebuggerString(remoteObject.unserializableValue, 128),
  };
}

function createPageRecordFromDebugTab(tab) {
  const url = typeof tab?.url === "string" ? tab.url : null;
  let pathname = null;

  if (url) {
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = null;
    }
  }

  return {
    url,
    pathname,
    title: typeof tab?.title === "string" && tab.title.trim() ? tab.title.trim() : null,
  };
}

function createCaptureBuckets() {
  return {
    console: [],
    runtimeExceptions: [],
    logEntries: [],
    networkFailures: [],
    httpErrors: [],
  };
}

function handleDebuggerProtocolEvent(buckets, method, params) {
  switch (method) {
    case "Runtime.consoleAPICalled": {
      pushDebuggerEntry(buckets.console, {
        type: normalizeDebuggerString(params?.type, 64),
        timestamp: Number.isFinite(params?.timestamp) ? params.timestamp : null,
        args: Array.isArray(params?.args) ? params.args.map(describeRemoteObject) : [],
        stackTrace: summarizeDebuggerValue(params?.stackTrace),
      });
      return;
    }
    case "Runtime.exceptionThrown": {
      const details = params?.exceptionDetails ?? {};
      pushDebuggerEntry(buckets.runtimeExceptions, {
        text: normalizeDebuggerString(details.text, 1_000),
        url: normalizeDebuggerString(details.url, 1_000),
        lineNumber: Number.isFinite(details.lineNumber) ? details.lineNumber : null,
        columnNumber: Number.isFinite(details.columnNumber) ? details.columnNumber : null,
        exception: describeRemoteObject(details.exception),
        stackTrace: summarizeDebuggerValue(details.stackTrace),
        timestamp: Number.isFinite(params?.timestamp) ? params.timestamp : null,
      });
      return;
    }
    case "Log.entryAdded": {
      const entry = params?.entry ?? {};
      pushDebuggerEntry(buckets.logEntries, {
        source: normalizeDebuggerString(entry.source, 64),
        level: normalizeDebuggerString(entry.level, 64),
        text: normalizeDebuggerString(entry.text, 1_500),
        url: normalizeDebuggerString(entry.url, 1_000),
        lineNumber: Number.isFinite(entry.lineNumber) ? entry.lineNumber : null,
        timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : null,
      });
      return;
    }
    case "Network.loadingFailed": {
      pushDebuggerEntry(buckets.networkFailures, {
        requestId: normalizeDebuggerString(params?.requestId, 128),
        errorText: normalizeDebuggerString(params?.errorText, 1_000),
        blockedReason: normalizeDebuggerString(params?.blockedReason, 128),
        canceled: params?.canceled === true,
        type: normalizeDebuggerString(params?.type, 64),
        timestamp: Number.isFinite(params?.timestamp) ? params.timestamp : null,
      });
      return;
    }
    case "Network.responseReceived": {
      const response = params?.response ?? null;
      if (!response || !Number.isFinite(response.status) || response.status < 400) {
        return;
      }

      pushDebuggerEntry(buckets.httpErrors, {
        requestId: normalizeDebuggerString(params?.requestId, 128),
        status: response.status,
        statusText: normalizeDebuggerString(response.statusText, 256),
        url: normalizeDebuggerString(response.url, 1_500),
        mimeType: normalizeDebuggerString(response.mimeType, 256),
        type: normalizeDebuggerString(params?.type, 64),
        timestamp: Number.isFinite(response.responseTime) ? response.responseTime : null,
      });
      return;
    }
    default:
      return;
  }
}

async function captureDebuggerDiagnostics(tab, command = {}) {
  if (!tab?.id) {
    throw new Error("Failed to resolve the target browser tab for debugger capture.");
  }

  const tabId = tab.id;
  const debuggee = createDebuggerTarget(tabId);
  const captureMs = clampDebuggerCaptureMs(command.captureMs);
  const refreshBeforeCapture = command.refreshBeforeCapture === true;
  const bypassCache = command.bypassCache === true;
  const buckets = createCaptureBuckets();
  let attached = false;
  let detachedReason = null;
  let settleDetach = null;

  const detachedPromise = new Promise((resolvePromise) => {
    settleDetach = resolvePromise;
  });

  function onEvent(source, method, params) {
    if (source?.tabId !== tabId) {
      return;
    }
    handleDebuggerProtocolEvent(buckets, method, params);
  }

  function onDetach(source, reason) {
    if (source?.tabId !== tabId) {
      return;
    }
    detachedReason = reason ?? "unknown";
    attached = false;
    settleDetach?.(reason ?? "unknown");
  }

  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);

  try {
    try {
      await chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message.includes("Another debugger is already attached")
          ? "Chrome DevTools or another debugger is already attached to this tab."
          : `Failed to attach chrome.debugger: ${message}`,
      );
    }
    attached = true;

    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    await chrome.debugger.sendCommand(debuggee, "Runtime.enable");
    await chrome.debugger.sendCommand(debuggee, "Log.enable");
    await chrome.debugger.sendCommand(debuggee, "Network.enable");

    if (refreshBeforeCapture) {
      await chrome.debugger.sendCommand(debuggee, "Page.reload", {
        ignoreCache: bypassCache,
      });
    }

    const result = await Promise.race([
      waitForDelay(captureMs).then(() => "complete"),
      detachedPromise.then((reason) => ({ detached: true, reason })),
    ]);

    let currentTab = null;
    try {
      currentTab = await chrome.tabs.get(tabId);
    } catch {
      currentTab = null;
    }

    return {
      page: createPageRecordFromDebugTab(currentTab),
      captureMs,
      refreshed: refreshBeforeCapture,
      bypassCache,
      detached:
        typeof result === "object" && result && result.detached === true ? result.reason ?? detachedReason : detachedReason,
      counts: {
        console: buckets.console.length,
        runtimeExceptions: buckets.runtimeExceptions.length,
        logEntries: buckets.logEntries.length,
        networkFailures: buckets.networkFailures.length,
        httpErrors: buckets.httpErrors.length,
      },
      console: buckets.console,
      runtimeExceptions: buckets.runtimeExceptions,
      logEntries: buckets.logEntries,
      networkFailures: buckets.networkFailures,
      httpErrors: buckets.httpErrors,
    };
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);

    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // Ignore detach races after capture completion.
      }
    }
  }
}
