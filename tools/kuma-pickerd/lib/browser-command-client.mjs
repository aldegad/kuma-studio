import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

import { createBrowserSessionSocketUrl, normalizeDaemonUrl } from "./browser-transport.mjs";
import { readNumber, readOptionalString } from "./cli-options.mjs";

export function getDaemonUrlFromOptions(options) {
  return normalizeDaemonUrl(options["daemon-url"]);
}

export function readCommandTargetOptions(options) {
  const tabId = readNumber(options, "tab-id", null);
  const targetUrl = readOptionalString(options, "url");
  const targetUrlContains = readOptionalString(options, "url-contains");

  return {
    targetTabId: Number.isInteger(tabId) ? tabId : null,
    targetUrl,
    targetUrlContains,
  };
}

export function requireCommandTarget(options, { allowUntargeted = false } = {}) {
  const targets = readCommandTargetOptions(options);
  if (!targets.targetTabId && !targets.targetUrl && !targets.targetUrlContains) {
    if (allowUntargeted) {
      return targets;
    }
    throw new Error("Browser commands require --tab-id, --url, or --url-contains.");
  }

  return targets;
}

function createRequestId() {
  return `browser-command-${randomUUID()}`;
}

function withBrowserRecoveryHint(message) {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (!normalized) {
    return "Browser command failed.";
  }

  if (normalized.includes("browser command tools are not loaded for this page yet")) {
    return `${normalized} Refresh the target page once or retry after the content script reattaches.`;
  }

  if (normalized.includes("No active browser connection is available")) {
    return `${normalized} Refresh the target page once so the extension can send a fresh presence heartbeat.`;
  }

  if (normalized.includes("socket closed before the command completed")) {
    return `${normalized} If the page just reloaded, refresh the target page once and retry.`;
  }

  return normalized;
}

export async function fetchJson(endpoint, init = {}, { allowNoContent = false } = {}) {
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

export async function enqueueBrowserCommand(options, payload, commandOptions = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const controllerTimeoutMs = timeoutMs + 2_000;
  const targets = requireCommandTarget(options, commandOptions);
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
          `Timed out waiting for the browser command result after ${controllerTimeoutMs}ms. Keep the target tab open with the extension connected. If the page just reloaded, refresh the target page once and retry.`,
        ),
      );
    }, controllerTimeoutMs);

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
            settle(rejectCommand, new Error(withBrowserRecoveryHint(message.error || "Browser command failed.")));
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
        settle(rejectCommand, new Error(withBrowserRecoveryHint("Browser control socket closed before the command completed.")));
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
