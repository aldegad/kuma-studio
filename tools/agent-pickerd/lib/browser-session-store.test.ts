import { describe, expect, it, vi } from "vitest";

describe("BrowserSessionStore", () => {
  it("tracks websocket browser presence in the session summary", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();

    store.registerHello(
      "browser-1",
      {
        type: "hello",
        role: "browser",
        extensionId: "ext-1",
        extensionName: "Agent Picker Bridge",
        extensionVersion: "0.1.0",
        browserName: "chrome",
      },
      vi.fn(),
    );

    const update = store.recordBrowserPresence("browser-1", {
      type: "presence.update",
      source: "content-script:page-heartbeat",
      page: {
        url: "https://developers.portone.io/opi/ko/integration/start/v2/readme?v=v2",
        pathname: "/opi/ko/integration/start/v2/readme",
        title: "PortOne Docs",
      },
      activeTabId: 42,
      visible: true,
      focused: true,
      capabilities: ["context", "click", "dom"],
      lastSeenAt: new Date().toISOString(),
    });

    expect(update.summary.connected).toBe(true);
    expect(update.summary.page?.title).toBe("PortOne Docs");
    expect(update.summary.activeTabId).toBe(42);
    expect(update.summary.focused).toBe(true);
    expect(update.summary.visible).toBe(true);
    expect(update.summary.capabilities).toEqual(["context", "click", "dom"]);
    expect(update.extensionStatus.source).toBe("content-script:page-heartbeat");
    expect(update.extensionStatus.browserTransport).toBe("websocket");
    expect(update.extensionStatus.socketConnected).toBe(true);
  });

  it("routes targeted websocket commands to the matching browser and forwards the result", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello(
      "browser-1",
      {
        type: "hello",
        role: "browser",
        extensionId: "ext-1",
      },
      browserSend,
    );
    store.recordBrowserPresence("browser-1", {
      type: "presence.update",
      source: "content-script:page-heartbeat",
      page: {
        url: "https://developers.portone.io/guide",
        pathname: "/guide",
        title: "Guide",
      },
      activeTabId: 77,
      visible: false,
      focused: false,
      capabilities: ["dom"],
      lastSeenAt: new Date().toISOString(),
    });

    store.registerHello(
      "controller-1",
      {
        type: "hello",
        role: "controller",
      },
      controllerSend,
    );

    const dispatched = store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-01",
      command: {
        type: "dom",
        targetUrlContains: "portone.io",
      },
    });

    expect(dispatched.requestId).toBe("browser-command-test-01");
    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-01",
        command: expect.objectContaining({
          resolvedTargetTabId: 77,
        }),
      }),
    );
    expect(controllerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.accepted",
        requestId: "browser-command-test-01",
      }),
    );

    store.completeBrowserCommand("browser-1", {
      type: "command.result",
      requestId: "browser-command-test-01",
      result: {
        pageContext: {
          page: {
            title: "Updated Page",
          },
        },
      },
    });

    expect(controllerSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "command.result",
        requestId: "browser-command-test-01",
        result: {
          pageContext: {
            page: {
              title: "Updated Page",
            },
          },
        },
      }),
    );
  });

  it("fails in-flight websocket commands when the browser disconnects", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.recordBrowserPresence("browser-1", {
      type: "presence.update",
      source: "content-script:page-heartbeat",
      page: {
        url: "https://example.com/background",
        pathname: "/background",
        title: "Background",
      },
      activeTabId: 55,
      visible: true,
      focused: true,
      capabilities: ["click"],
      lastSeenAt: new Date().toISOString(),
    });
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-02",
      command: {
        type: "click",
        targetTabId: 55,
        text: "Continue",
      },
    });

    store.disconnect("browser-1");

    expect(controllerSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "command.error",
        requestId: "browser-command-test-02",
        error: expect.stringContaining("disconnected"),
      }),
    );
    expect(store.readSummary().connected).toBe(false);
  });

  it("keeps the legacy polling queue available for explicit fallback mode", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();

    const command = store.enqueueCommand({
      type: "fill",
      value: "https://ddalkkakposting.com/privacy",
      selector: "input[name='privacy']",
      targetUrlContains: "ddalkkakposting.com",
    });

    expect(command.status).toBe("pending");
    expect(command.selector).toBe("input[name='privacy']");

    const claimed = store.claimNextCommand({
      tabId: 9,
      url: "https://ddalkkakposting.com/settings",
      visible: true,
      focused: true,
    });
    expect(claimed?.id).toBe(command.id);
  });

  it("rejects untargeted browser commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();

    expect(() =>
      store.enqueueCommand({
        type: "dom",
      }),
    ).toThrow("Browser commands must include targetTabId, targetUrl, or targetUrlContains.");
  });
});
