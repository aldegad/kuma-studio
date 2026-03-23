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
        extensionName: "Kuma Picker Bridge",
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

  it("can dispatch targeted websocket commands through a single browser connection without cached live presence", async () => {
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
      requestId: "browser-command-test-03",
      command: {
        type: "context",
        targetUrlContains: "admin.portone.io",
      },
    });

    expect(dispatched.requestId).toBe("browser-command-test-03");
    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-03",
        command: expect.objectContaining({
          type: "context",
          targetUrlContains: "admin.portone.io",
          targetTabId: null,
          resolvedTargetTabId: null,
        }),
      }),
    );
  });

  it("does not coerce null tab ids into zero for url-targeted commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-04",
      command: {
        type: "context",
        targetTabId: null,
        resolvedTargetTabId: null,
        targetUrlContains: "admin.portone.io",
      },
    });

    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-04",
        command: expect.objectContaining({
          targetTabId: null,
          resolvedTargetTabId: null,
          targetUrlContains: "admin.portone.io",
        }),
      }),
    );
  });

  it("preserves bypass-cache refresh options when dispatching websocket commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-05",
      command: {
        type: "refresh",
        targetUrlContains: "staging.example.com",
        bypassCache: true,
      },
    });

    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-05",
        command: expect.objectContaining({
          type: "refresh",
          targetUrlContains: "staging.example.com",
          bypassCache: true,
        }),
      }),
    );
  });

  it("preserves debugger capture options when dispatching websocket commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-06",
      command: {
        type: "debugger-capture",
        targetUrlContains: "staging.example.com",
        refreshBeforeCapture: true,
        bypassCache: true,
        captureMs: 4_000,
      },
    });

    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-06",
        command: expect.objectContaining({
          type: "debugger-capture",
          targetUrlContains: "staging.example.com",
          refreshBeforeCapture: true,
          bypassCache: true,
          captureMs: 4_000,
        }),
      }),
    );
  });

  it("preserves file lists when dispatching websocket commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-06a",
      command: {
        type: "set-files",
        targetTabId: 123,
        selector: "input[type=file]",
        files: ["/tmp/one.png", "/tmp/two.png"],
      },
    });

    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-06a",
        command: expect.objectContaining({
          type: "set-files",
          targetTabId: 123,
          selector: "input[type=file]",
          files: ["/tmp/one.png", "/tmp/two.png"],
        }),
      }),
    );
  });

  it("preserves recording options when dispatching websocket commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.recordBrowserPresence("browser-1", {
      type: "presence.update",
      source: "content-script:page-heartbeat",
      page: {
        url: "http://localhost:3000/video",
        pathname: "/video",
        title: "Video",
      },
      activeTabId: 991,
      visible: true,
      focused: true,
      capabilities: ["record-start", "record-stop"],
      lastSeenAt: new Date().toISOString(),
    });
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-06c",
        command: {
          type: "record-start",
          targetTabId: 991,
          fps: 2,
          speedMultiplier: 3,
          filename: "kuma-picker-recordings/test.webm",
          restorePreviousActiveTab: true,
        },
    });

    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-06c",
        command: expect.objectContaining({
          type: "record-start",
          targetTabId: 991,
          fps: 2,
          speedMultiplier: 3,
          filename: "kuma-picker-recordings/test.webm",
          restorePreviousActiveTab: true,
        }),
      }),
    );
  });

  it("preserves eval expression payloads when dispatching websocket commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-06b",
      command: {
        type: "eval",
        targetUrlContains: "localhost:3000/contenteditable-lab",
        expression: "document.title",
        text: "document.title",
        value: "document.title",
      },
    });

    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-06b",
        command: expect.objectContaining({
          type: "eval",
          targetUrlContains: "localhost:3000/contenteditable-lab",
          expression: "document.title",
          text: "document.title",
          value: "document.title",
        }),
      }),
    );
  });

  it("preserves advanced interaction payloads for key hold and pointer drag commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-07",
      command: {
        type: "key",
        targetUrlContains: "localhost:3000/shooting",
        key: "z",
        holdMs: 900,
      },
    });

    expect(browserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-07",
        command: expect.objectContaining({
          type: "key",
          key: "z",
          holdMs: 900,
        }),
      }),
    );

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-08",
      command: {
        type: "pointer-drag",
        targetUrlContains: "localhost:3000/shooting",
        fromX: 357,
        fromY: 710,
        toX: 275,
        toY: 710,
        steps: 18,
        durationMs: 800,
      },
    });

    expect(browserSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-08",
        command: expect.objectContaining({
          type: "pointer-drag",
          fromX: 357,
          fromY: 710,
          toX: 275,
          toY: 710,
          steps: 18,
          durationMs: 800,
        }),
      }),
    );
  });

  it("rejects untargeted websocket browser commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    expect(() =>
      store.dispatchControllerCommand("controller-1", {
        type: "command.request",
        requestId: "browser-command-test-07",
        command: {
        type: "dom",
        },
      }),
    ).toThrow("Browser commands must include targetTabId, targetUrl, or targetUrlContains.");
  });

  it("adds a refresh hint when no live browser connection is available", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const controllerSend = vi.fn();

    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    expect(() =>
      store.dispatchControllerCommand("controller-1", {
        type: "command.request",
        requestId: "browser-command-test-09",
        command: {
          type: "dom",
          targetTabId: 1140012187,
        },
      }),
    ).toThrow("Refresh the target page once so the extension can send a fresh presence heartbeat.");
  });

  it("preserves screenshot focus restoration options when dispatching websocket commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.recordBrowserPresence("browser-1", {
      type: "presence.update",
      source: "content-script:page-heartbeat",
      page: {
        url: "http://localhost:3000/shooting",
        pathname: "/shooting",
        title: "Kuma Test Lab",
      },
      activeTabId: 1140012187,
      visible: false,
      focused: false,
      capabilities: ["screenshot"],
      lastSeenAt: new Date().toISOString(),
    });
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-10",
      command: {
        type: "screenshot",
        targetTabId: 1140012187,
        focusTabFirst: true,
        restorePreviousActiveTab: true,
      },
    });

    expect(browserSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-10",
        command: expect.objectContaining({
          type: "screenshot",
          focusTabFirst: true,
          restorePreviousActiveTab: true,
        }),
      }),
    );
  });

  it("allows untargeted navigate commands through a single browser connection", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();
    const browserSend = vi.fn();
    const controllerSend = vi.fn();

    store.registerHello("browser-1", { type: "hello", role: "browser", extensionId: "ext-1" }, browserSend);
    store.registerHello("controller-1", { type: "hello", role: "controller" }, controllerSend);

    store.dispatchControllerCommand("controller-1", {
      type: "command.request",
      requestId: "browser-command-test-11",
      command: {
        type: "navigate",
        navigationUrl: "http://localhost:3000",
        newTab: true,
      },
    });

    expect(browserSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-11",
        command: expect.objectContaining({
          type: "navigate",
          navigationUrl: "http://localhost:3000",
          newTab: true,
          targetTabId: null,
          targetUrl: null,
          targetUrlContains: null,
        }),
      }),
    );
  });
});
