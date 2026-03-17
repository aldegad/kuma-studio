import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocket } from "ws";

import {
  createBrowserSessionSocketUrl,
  normalizeDaemonUrl,
  resolveBrowserTransportMode,
} from "./browser-transport.mjs";
import { readNumber, readOptionalString, requireString } from "./cli-options.mjs";

function getDaemonUrlFromOptions(options) {
  return normalizeDaemonUrl(options["daemon-url"]);
}

function readCommandTargetOptions(options) {
  const tabId = readNumber(options, "tab-id", null);
  const targetUrl = readOptionalString(options, "url");
  const targetUrlContains = readOptionalString(options, "url-contains");

  return {
    targetTabId: Number.isInteger(tabId) ? tabId : null,
    targetUrl,
    targetUrlContains,
  };
}

function requireCommandTarget(options) {
  const targets = readCommandTargetOptions(options);
  if (!targets.targetTabId && !targets.targetUrl && !targets.targetUrlContains) {
    throw new Error("Browser commands require --tab-id, --url, or --url-contains.");
  }

  return targets;
}

function createRequestId() {
  return `browser-command-${randomUUID()}`;
}

async function fetchJson(endpoint, init = {}, { allowNoContent = false } = {}) {
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (allowNoContent && response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Request failed with status ${response.status}.`);
  }

  return response.json();
}

async function enqueueLegacyBrowserCommand(daemonUrl, options, payload) {
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const pollIntervalMs = 250;
  const startedAt = Date.now();
  const targets = requireCommandTarget(options);
  const command = await fetchJson(`${daemonUrl}/browser-session/commands`, {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      ...targets,
      timeoutMs,
    }),
  });

  while (Date.now() - startedAt <= timeoutMs) {
    const result = await fetchJson(`${daemonUrl}/browser-session/commands/${command.id}`, {
      method: "GET",
      headers: {},
    });

    if (result?.status === "completed" || result?.status === "failed") {
      if (result.status === "failed") {
        throw new Error(result.error || "Browser command failed.");
      }

      return result;
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, pollIntervalMs);
    });
  }

  throw new Error(
    `Timed out waiting for the browser command result after ${timeoutMs}ms. Keep the target tab active and focused so the extension can execute the command.`,
  );
}

function connectWebSocket(url) {
  return new Promise((resolveConnection, rejectConnection) => {
    const socket = new WebSocket(url);
    const cleanup = () => {
      socket.removeAllListeners("open");
      socket.removeAllListeners("error");
    };

    socket.once("open", () => {
      cleanup();
      resolveConnection(socket);
    });

    socket.once("error", (error) => {
      cleanup();
      rejectConnection(error);
    });
  });
}

async function enqueueWebSocketBrowserCommand(daemonUrl, options, payload) {
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const targets = requireCommandTarget(options);
  const requestId = createRequestId();
  const socket = await connectWebSocket(createBrowserSessionSocketUrl(daemonUrl));

  return new Promise((resolveCommand, rejectCommand) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      rejectCommand(
        new Error(
          `Timed out waiting for the browser command result after ${timeoutMs}ms. Keep the target tab open with the extension connected.`,
        ),
      );
    }, timeoutMs);

    function settle(handler, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Ignore close races after the command settled.
      }
      handler(value);
    }

    socket.on("message", (rawMessage) => {
      let message = null;
      try {
        message = JSON.parse(rawMessage.toString("utf8"));
      } catch {
        return;
      }

      switch (message?.type) {
        case "ping":
          socket.send(JSON.stringify({ type: "pong", sentAt: new Date().toISOString() }));
          return;
        case "command.result":
          if (message.requestId === requestId) {
            settle(resolveCommand, { result: message.result ?? null });
          }
          return;
        case "command.error":
          if (!message.requestId || message.requestId === requestId) {
            settle(rejectCommand, new Error(message.error || "Browser command failed."));
          }
          return;
        default:
          return;
      }
    });

    socket.on("error", (error) => {
      settle(rejectCommand, error instanceof Error ? error : new Error(String(error)));
    });

    socket.on("close", () => {
      if (!settled) {
        settle(rejectCommand, new Error("Browser control socket closed before the command completed."));
      }
    });

    socket.send(
      JSON.stringify({
        type: "hello",
        role: "controller",
      }),
    );
    socket.send(
      JSON.stringify({
        type: "command.request",
        requestId,
        command: {
          ...payload,
          ...targets,
          timeoutMs,
        },
      }),
    );
  });
}

async function enqueueBrowserCommand(options, payload) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const transportMode = await resolveBrowserTransportMode(daemonUrl);
  if (transportMode === "legacy-poll") {
    return enqueueLegacyBrowserCommand(daemonUrl, options, payload);
  }

  return enqueueWebSocketBrowserCommand(daemonUrl, options, payload);
}

function writeScreenshotFile(filePath, dataUrl) {
  const match = typeof dataUrl === "string" ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
  if (!match) {
    throw new Error("The browser screenshot result did not include a PNG data URL.");
  }

  writeFileSync(resolve(filePath), Buffer.from(match[2], "base64"));
}

export async function commandGetBrowserSession(options) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const session = await fetchJson(`${daemonUrl}/browser-session`, {
    method: "GET",
    headers: {},
  });
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}

export async function commandBrowserContext(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "context",
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserDom(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "dom",
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserClick(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const text = readOptionalString(options, "text");
  const role = readOptionalString(options, "role");
  const within = readOptionalString(options, "within");
  const nth = readNumber(options, "nth", null);
  const exactText = options["exact-text"] === true;

  if (!selector && !selectorPath && !text) {
    throw new Error("browser-click requires --selector, --selector-path, or --text.");
  }

  if (nth != null && (!Number.isInteger(nth) || nth < 1)) {
    throw new Error("browser-click --nth must be a positive integer.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "click",
    selector,
    selectorPath,
    text,
    role,
    within,
    nth,
    exactText,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 400),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserClickPoint(options) {
  const x = readNumber(options, "x", null);
  const y = readNumber(options, "y", null);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("browser-click-point requires --x and --y.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "click-point",
    x,
    y,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 400),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserFill(options) {
  const value = typeof options.value === "string" ? options.value : null;
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const label = readOptionalString(options, "label");
  const text = readOptionalString(options, "text");

  if (value == null) {
    throw new Error("browser-fill requires --value.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "fill",
    value,
    selector,
    selectorPath,
    label,
    text,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 100),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserKey(options) {
  const key = readOptionalString(options, "key");
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const text = readOptionalString(options, "text");

  if (!key) {
    throw new Error("browser-key requires --key.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "key",
    key,
    selector,
    selectorPath,
    text,
    shiftKey: options["shift"] === true,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 100),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserWaitForText(options) {
  const text = readOptionalString(options, "text");
  if (!text) {
    throw new Error("browser-wait-for-text requires --text.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-text",
    text,
    scope: readOptionalString(options, "scope"),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserWaitForTextDisappear(options) {
  const text = readOptionalString(options, "text");
  if (!text) {
    throw new Error("browser-wait-for-text-disappear requires --text.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-text-disappear",
    text,
    scope: readOptionalString(options, "scope"),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserWaitForSelector(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");

  if (!selector && !selectorPath) {
    throw new Error("browser-wait-for-selector requires --selector or --selector-path.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-selector",
    selector,
    selectorPath,
    scope: readOptionalString(options, "scope"),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserWaitForDialogClose(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-dialog-close",
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserQueryDom(options) {
  const kind = readOptionalString(options, "kind");
  const text = readOptionalString(options, "text");
  const scope = readOptionalString(options, "scope");

  if (!kind) {
    throw new Error("browser-query-dom requires --kind.");
  }

  if ((kind === "nearby-input" || kind === "input-by-label") && !text) {
    throw new Error(`browser-query-dom --kind ${kind} requires --text.`);
  }

  const result = await enqueueBrowserCommand(options, {
    type: "query-dom",
    kind,
    text,
    scope,
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserScreenshot(options) {
  const file = requireString(options, "file");
  const result = await enqueueBrowserCommand(options, {
    type: "screenshot",
    focusTabFirst: options["focus-tab-first"] !== false,
  });
  const screenshot = result.result?.screenshot ?? null;
  const capture = result.result?.capture ?? null;

  if (!screenshot?.dataUrl) {
    throw new Error("The browser screenshot result did not include image data.");
  }

  writeScreenshotFile(file, screenshot.dataUrl);
  process.stdout.write(
    `${JSON.stringify(
      {
        file: resolve(file),
        page: result.result?.page ?? null,
        width: screenshot.width ?? 0,
        height: screenshot.height ?? 0,
        capturedAt: screenshot.capturedAt ?? null,
        capturedTabId: capture?.tabId ?? null,
        capturedWindowId: capture?.windowId ?? null,
        focused: capture?.focused ?? null,
        active: capture?.active ?? null,
      },
      null,
      2,
    )}\n`,
  );
}
