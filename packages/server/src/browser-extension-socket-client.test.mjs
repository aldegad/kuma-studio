import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

const SOCKET_CLIENT_PATH = path.resolve(process.cwd(), "packages/browser-extension/background/socket-client.js");

function createHarness() {
  const source = readFileSync(SOCKET_CLIENT_PATH, "utf8");
  const sockets = [];

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    }

    send(payload) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }

    emit(type, event = {}) {
      if (type === "open") {
        this.readyState = FakeWebSocket.OPEN;
      } else if (type === "close") {
        this.readyState = FakeWebSocket.CLOSED;
      }

      for (const handler of this.listeners.get(type) ?? []) {
        handler(event);
      }
    }
  }

  const context = {
    console,
    Date,
    JSON,
    URL,
    setTimeout,
    clearTimeout,
    WebSocket: FakeWebSocket,
    KumaPickerExtensionShared: {
      createDaemonSocketUrl(rawValue) {
        const endpoint = new URL(`${rawValue.replace(/\/+$/, "")}/browser-session/socket`);
        endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
        return endpoint.toString();
      },
      normalizeDaemonUrl(rawValue) {
        return rawValue.replace(/\/+$/, "");
      },
    },
    reportExtensionHeartbeat: vi.fn(async () => {}),
    fetchDaemonHealth: vi.fn(async () => ({ ok: true })),
    getExtensionManifestMetadata: vi.fn(() => ({
      extensionId: "ext-1",
      extensionName: "Kuma Picker Bridge",
      extensionVersion: "1.0.0",
      browserName: "chrome",
    })),
    resolveTargetTab: vi.fn(async () => ({ id: 1 })),
    sendMessageToTab: vi.fn(async () => {}),
    handleSocketCommandRequest: vi.fn(async () => {}),
    chrome: {
      runtime: {
        reload: vi.fn(),
      },
    },
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(source, context, { filename: SOCKET_CLIENT_PATH });

  return {
    sockets,
    ensureDaemonTransport: context.ensureDaemonTransport,
    sendDaemonSocketMessage: context.sendDaemonSocketMessage,
  };
}

function readSentMessages(socket) {
  return socket.sent.map((payload) => JSON.parse(payload));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("browser extension socket client", () => {
  it("reconnects with exponential backoff and caps at 30 seconds", async () => {
    vi.useFakeTimers();
    const { sockets, ensureDaemonTransport } = createHarness();

    await ensureDaemonTransport("http://127.0.0.1:4312");
    expect(sockets).toHaveLength(1);

    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];

    for (const [index, delay] of expectedDelays.entries()) {
      const currentSocket = sockets.at(-1);
      currentSocket?.emit("close");

      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(index + 1);

      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(index + 2);
    }
  });

  it("schedules reconnect on error and resets backoff after a successful open", async () => {
    vi.useFakeTimers();
    const { sockets, ensureDaemonTransport } = createHarness();

    await ensureDaemonTransport("http://127.0.0.1:4312");
    expect(sockets).toHaveLength(1);

    sockets[0]?.emit("error");
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    sockets[1]?.emit("open");
    sockets[1]?.emit("close");
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it("replays the latest presence update after reconnect", async () => {
    vi.useFakeTimers();
    const { sockets, ensureDaemonTransport, sendDaemonSocketMessage } = createHarness();

    await ensureDaemonTransport("http://127.0.0.1:4312");
    const firstSocket = sockets[0];
    firstSocket?.emit("open");
    firstSocket?.emit("message", { data: JSON.stringify({ type: "hello" }) });

    const sentImmediately = sendDaemonSocketMessage({
      type: "presence.update",
      source: "test:presence",
      page: { url: "https://example.com" },
      activeTabId: 7,
      visible: true,
      focused: true,
      capabilities: ["run", "screenshot"],
      lastSeenAt: "2026-04-08T00:00:00.000Z",
      browserUserAgent: "Chrome",
    });

    expect(sentImmediately).toBe(true);
    expect(readSentMessages(firstSocket)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "hello", role: "browser" }),
        expect.objectContaining({ type: "presence.update", activeTabId: 7 }),
      ]),
    );

    firstSocket?.emit("close");
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    const secondSocket = sockets[1];
    secondSocket?.emit("open");
    expect(readSentMessages(secondSocket)).toEqual([
      expect.objectContaining({ type: "hello", role: "browser" }),
    ]);

    secondSocket?.emit("message", { data: JSON.stringify({ type: "hello" }) });
    expect(readSentMessages(secondSocket)).toEqual([
      expect.objectContaining({ type: "hello", role: "browser" }),
      expect.objectContaining({ type: "presence.update", activeTabId: 7 }),
    ]);
  });
});
