import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";

import { readNumber, readOptionalString } from "./cli-options.mjs";
import { DEFAULT_PORT } from "./constants.mjs";

export function normalizeDaemonUrl(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  return (trimmed || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/+$/, "");
}

export function getDaemonUrlFromOptions(options) {
  return normalizeDaemonUrl(options["daemon-url"]);
}

export function createBrowserSessionSocketUrl(daemonUrl) {
  const endpoint = new URL(`${normalizeDaemonUrl(daemonUrl)}/browser-session/socket`);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  return endpoint.toString();
}

export function readTargetOptions(options) {
  const tabId = readNumber(options, "tab-id", null);
  const targetUrl = readOptionalString(options, "url");
  const targetUrlContains = readOptionalString(options, "url-contains");

  return {
    targetTabId: Number.isInteger(tabId) ? tabId : null,
    targetUrl,
    targetUrlContains,
  };
}

export function requireTarget(options) {
  const target = readTargetOptions(options);
  if (!target.targetTabId && !target.targetUrl && !target.targetUrlContains) {
    throw new Error("The run command requires --tab-id, --url, or --url-contains.");
  }

  return target;
}

function withRecoveryHint(message) {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (!normalized) {
    return "Automation request failed.";
  }

  if (normalized.includes("automation runtime is not loaded")) {
    return `${normalized} Refresh the target page once or retry after the content script reattaches.`;
  }

  if (normalized.includes("No active browser connection is available")) {
    if (normalized.includes("Try page.goto() instead of page.reload() for stale connections")) {
      return normalized;
    }
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

export class AutomationClient {
  #daemonUrl;
  #targets;
  #defaultTimeoutMs;
  #socket = null;
  #connected = false;
  #pending = new Map();

  constructor({ daemonUrl, targets, defaultTimeoutMs = 15_000 }) {
    this.#daemonUrl = normalizeDaemonUrl(daemonUrl);
    this.#targets = targets;
    this.#defaultTimeoutMs = defaultTimeoutMs;
  }

  async connect() {
    if (this.#connected && this.#socket) {
      return;
    }

    const socket = await new Promise((resolveConnection, rejectConnection) => {
      const nextSocket = new WebSocket(createBrowserSessionSocketUrl(this.#daemonUrl));
      const cleanup = () => {
        nextSocket.removeAllListeners("open");
        nextSocket.removeAllListeners("error");
      };

      nextSocket.once("open", () => {
        cleanup();
        resolveConnection(nextSocket);
      });

      nextSocket.once("error", (error) => {
        cleanup();
        rejectConnection(error);
      });
    });

    this.#socket = socket;
    this.#socket.on("message", (rawMessage) => {
      this.#handleMessage(rawMessage.toString("utf8"));
    });
    this.#socket.on("error", (error) => {
      this.#rejectAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.#socket.on("close", () => {
      this.#rejectAll(new Error(withRecoveryHint("Automation socket closed before the command completed.")));
      this.#socket = null;
      this.#connected = false;
    });
    this.#socket.send(
      JSON.stringify({
        type: "hello",
        role: "controller",
      }),
    );
    this.#connected = true;
  }

  async send(action, payload = {}, { timeoutMs } = {}) {
    return this.sendCommand(
      {
        type: "playwright",
        action,
        ...payload,
      },
      { timeoutMs },
    );
  }

  async sendCommand(command, { timeoutMs } = {}) {
    await this.connect();

    const requestId = `automation-${randomUUID()}`;
    const effectiveTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.round(timeoutMs) : this.#defaultTimeoutMs;

    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        rejectRequest(
          new Error(
            `Timed out waiting for the automation result after ${effectiveTimeoutMs}ms. Keep the target tab open with the extension connected.`,
          ),
        );
      }, effectiveTimeoutMs + 2_000);

      this.#pending.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });

      this.#socket.send(
        JSON.stringify({
          type: "command.request",
          requestId,
          command: {
            ...this.#targets,
            ...(command && typeof command === "object" ? command : {}),
            timeoutMs:
              Number.isFinite(command?.timeoutMs) && command.timeoutMs > 0
                ? Math.round(command.timeoutMs)
                : effectiveTimeoutMs,
          },
        }),
      );
    });
  }

  async close() {
    if (!this.#socket) {
      return;
    }

    const socket = this.#socket;
    this.#socket = null;
    this.#connected = false;
    await new Promise((resolveClose) => {
      socket.once("close", () => resolveClose());
      try {
        socket.close();
      } catch {
        resolveClose();
      }
    });
  }

  #handleMessage(rawMessage) {
    let message = null;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (message?.type === "ping") {
      this.#socket?.send(JSON.stringify({ type: "pong", sentAt: new Date().toISOString() }));
      return;
    }

    if (message?.type !== "command.result" && message?.type !== "command.error") {
      return;
    }

    const requestId = typeof message?.requestId === "string" ? message.requestId : null;
    if (!requestId) {
      return;
    }

    const pending = this.#pending.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.#pending.delete(requestId);

    if (message.type === "command.error") {
      pending.reject(new Error(withRecoveryHint(message.error || "Automation request failed.")));
      return;
    }

    pending.resolve(message.result ?? null);
  }

  #rejectAll(error) {
    for (const [requestId, pending] of this.#pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(requestId);
    }
  }
}
