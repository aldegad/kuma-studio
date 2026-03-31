const DEBUGGER_PROTOCOL_VERSION = "1.3";
const DEFAULT_DEBUGGER_CAPTURE_MS = 3_000;
const MAX_DEBUGGER_EVENTS = 100;
const DebuggerAsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

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

function clampPostActionDelayMs(value, fallback = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return Math.min(10_000, Math.round(numeric));
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

function serializeDebuggerEvaluateArg(arg) {
  try {
    return JSON.stringify(arg === undefined ? null : arg);
  } catch (error) {
    throw new Error(
      `page.evaluate received an arg that could not be serialized for debugger execution: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function getDebuggerEvaluateSource(command = {}) {
  const kind = command?.kind === "function" ? "function" : "expression";
  const source = typeof command?.source === "string" ? command.source.trim() : "";
  if (!source) {
    throw new Error("page.evaluate requires a function or non-empty expression string.");
  }

  return {
    kind,
    source,
    argLiteral: serializeDebuggerEvaluateArg(command?.arg ?? null),
  };
}

function buildExpressionEvaluateBody(source) {
  try {
    void new DebuggerAsyncFunction("window", "document", "globalThis", "page", "arg", `return (${source});`);
    return `return (${source});`;
  } catch {
    return source;
  }
}

function buildDebuggerEvaluateExpression(command = {}) {
  const evaluateInput = getDebuggerEvaluateSource(command);
  const executionBody =
    evaluateInput.kind === "function" ? `return await (${evaluateInput.source})(arg);` : buildExpressionEvaluateBody(evaluateInput.source);

  return `(
    async () => {
      const page = {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
      };
      const arg = ${evaluateInput.argLiteral};
      function serializeValue(value, depth = 0, seen = new WeakSet()) {
        if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return value ?? null;
        }

        if (typeof value === "bigint") {
          return { kind: "bigint", value: String(value) };
        }

        if (typeof value === "undefined") {
          return { kind: "undefined" };
        }

        if (typeof value === "function") {
          return { kind: "function", name: value.name || null };
        }

        if (depth >= 4) {
          return { kind: "max-depth" };
        }

        if (value instanceof Element) {
          return {
            kind: "element",
            element: {
              tagName: value.tagName || null,
              id: value.id || null,
              role: value.getAttribute?.("role") || null,
              label:
                value.getAttribute?.("aria-label") ||
                value.getAttribute?.("title") ||
                value.textContent?.trim?.() ||
                null,
            },
          };
        }

        if (value instanceof Error) {
          return {
            kind: "error",
            name: value.name,
            message: value.message,
            stack: typeof value.stack === "string" ? value.stack : null,
          };
        }

        if (value instanceof Date) {
          return {
            kind: "date",
            value: value.toISOString(),
          };
        }

        if (Array.isArray(value)) {
          return value.slice(0, 50).map((entry) => serializeValue(entry, depth + 1, seen));
        }

        if (typeof value === "object") {
          if (seen.has(value)) {
            return { kind: "circular" };
          }

          seen.add(value);
          return Object.fromEntries(
            Object.entries(value)
              .slice(0, 50)
              .map(([key, entry]) => [key, serializeValue(entry, depth + 1, seen)]),
          );
        }

        return String(value);
      }

      try {
        const value = await (async () => {
          ${executionBody}
        })();
        return {
          ok: true,
          page,
          value: serializeValue(value),
          executionWorld: "main-world",
          evaluateBackend: "debugger",
        };
      } catch (error) {
        return {
          ok: false,
          page,
          exception: {
            name: error instanceof Error ? error.name : null,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error && typeof error.stack === "string" ? error.stack : null,
            value: serializeValue(error),
          },
          executionWorld: "main-world",
          evaluateBackend: "debugger",
        };
      }
    }
  )()`;
}

function shouldFallbackDebuggerEvaluate(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Chrome DevTools or another debugger is already attached") ||
    message.includes("Failed to attach chrome.debugger")
  );
}

async function executeDebuggerEvaluateCommand(tab, command = {}) {
  if (!tab?.id) {
    throw new Error("Failed to resolve the target browser tab for debugger evaluation.");
  }

  const tabId = tab.id;
  const debuggee = createDebuggerTarget(tabId);
  let attached = false;
  const expression = buildDebuggerEvaluateExpression(command);

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

    await chrome.debugger.sendCommand(debuggee, "Runtime.enable");

    const evaluation = await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    let currentTab = null;
    try {
      currentTab = await chrome.tabs.get(tabId);
    } catch {
      currentTab = null;
    }

    if (evaluation?.exceptionDetails) {
      return {
        page: createPageRecordFromDebugTab(currentTab),
        expression,
        exception: {
          text: normalizeDebuggerString(evaluation.exceptionDetails.text, 1_500),
          lineNumber: Number.isFinite(evaluation.exceptionDetails.lineNumber) ? evaluation.exceptionDetails.lineNumber : null,
          columnNumber: Number.isFinite(evaluation.exceptionDetails.columnNumber) ? evaluation.exceptionDetails.columnNumber : null,
          exception: describeRemoteObject(evaluation.exceptionDetails.exception),
        },
        value: null,
        executionWorld: "main-world",
        evaluateBackend: "debugger",
      };
    }

    const value =
      "value" in (evaluation?.result ?? {})
        ? summarizeDebuggerValue(evaluation.result.value)
        : describeRemoteObject(evaluation?.result);

    if (value?.ok === false) {
      const message = value?.exception?.message || "page.evaluate failed in the debugger execution world.";
      const error = new Error(message);
      error.name = value?.exception?.name || error.name;
      throw error;
    }

    if (value?.ok === true) {
      return value;
    }

    return {
      page: createPageRecordFromDebugTab(currentTab),
      expression,
      value,
      executionWorld: "main-world",
      evaluateBackend: "debugger",
    };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // Ignore detach races after evaluation completion.
      }
    }
  }
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

function normalizeDebuggerFilePaths(command) {
  const files = Array.isArray(command?.files)
    ? command.files
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

  if (files.length === 0) {
    throw new Error("The set-files command requires at least one local file path.");
  }

  return files;
}

function getDebuggerCommandSelector(command) {
  const selectorCandidate =
    typeof command?.selectorPath === "string"
      ? command.selectorPath
      : typeof command?.selector === "string"
        ? command.selector
        : "";
  const selector = selectorCandidate.trim();

  if (!selector) {
    throw new Error("The set-files command requires --selector or --selector-path.");
  }

  return selector;
}

function readNodeAttributeMap(node) {
  const attributes = Array.isArray(node?.attributes) ? node.attributes : [];
  const map = new Map();

  for (let index = 0; index < attributes.length; index += 2) {
    const key = typeof attributes[index] === "string" ? attributes[index].toLowerCase() : null;
    if (!key) {
      continue;
    }

    const value = typeof attributes[index + 1] === "string" ? attributes[index + 1] : "";
    map.set(key, value);
  }

  return map;
}

async function setFileInputFiles(tab, command = {}) {
  if (!tab?.id) {
    throw new Error("Failed to resolve the target browser tab for file upload.");
  }

  const selector = getDebuggerCommandSelector(command);
  const files = normalizeDebuggerFilePaths(command);
  const tabId = tab.id;
  const debuggee = createDebuggerTarget(tabId);
  let attached = false;

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

    await chrome.debugger.sendCommand(debuggee, "DOM.enable");
    await chrome.debugger.sendCommand(debuggee, "Runtime.enable");

    const { root } = await chrome.debugger.sendCommand(debuggee, "DOM.getDocument");
    const { nodeId } = await chrome.debugger.sendCommand(debuggee, "DOM.querySelector", {
      nodeId: root?.nodeId,
      selector,
    });

    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      throw new Error(`No element matched the selector "${selector}".`);
    }

    const described = await chrome.debugger.sendCommand(debuggee, "DOM.describeNode", {
      nodeId,
    });
    const node = described?.node ?? null;
    const nodeName = typeof node?.nodeName === "string" ? node.nodeName.toLowerCase() : null;
    const attributes = readNodeAttributeMap(node);
    const inputType = (attributes.get("type") ?? "text").trim().toLowerCase();

    if (nodeName !== "input" || inputType !== "file") {
      throw new Error(`Selector "${selector}" did not resolve to an <input type="file"> element.`);
    }

    if (files.length > 1 && !attributes.has("multiple")) {
      throw new Error(`Selector "${selector}" resolved to a single-file input. Provide one file or target an input with the multiple attribute.`);
    }

    await chrome.debugger.sendCommand(debuggee, "DOM.setFileInputFiles", {
      nodeId,
      files,
    });

    const resolvedNode = await chrome.debugger.sendCommand(debuggee, "DOM.resolveNode", {
      nodeId,
    });
    const objectId = typeof resolvedNode?.object?.objectId === "string" ? resolvedNode.object.objectId : null;
    let selectedFiles = [];

    if (objectId) {
      const dispatched = await chrome.debugger.sendCommand(debuggee, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function () {
          this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          return this.files
            ? Array.from(this.files, function (file) {
                return {
                  name: file.name,
                  type: file.type || null,
                  size: Number.isFinite(file.size) ? file.size : null,
                };
              })
            : [];
        }`,
        returnByValue: true,
        userGesture: true,
        awaitPromise: false,
      });
      selectedFiles = Array.isArray(dispatched?.result?.value) ? dispatched.result.value : [];
    }

    await waitForDelay(clampPostActionDelayMs(command?.postActionDelayMs, 100));

    let currentTab = null;
    try {
      currentTab = await chrome.tabs.get(tabId);
    } catch {
      currentTab = null;
    }

    return {
      page: createPageRecordFromDebugTab(currentTab),
      selector,
      fileCount: files.length,
      selectedFiles,
      multiple: attributes.has("multiple"),
    };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // Ignore detach races after file selection completion.
      }
    }
  }
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
