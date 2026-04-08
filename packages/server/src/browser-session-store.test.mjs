import { assert, describe, it } from "vitest";

import { BrowserSessionStore } from "./browser-session-store.mjs";

describe("browser-session-store", () => {
  it("reflects extension heartbeats in the browser session summary", () => {
    const store = new BrowserSessionStore();

    const summary = store.recordExtensionHeartbeat({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      extensionName: "Kuma Picker Bridge",
      extensionVersion: "1.2.3",
      browserName: "chrome",
      source: "content-script:page-heartbeat",
      lastSeenAt: new Date().toISOString(),
      page: {
        url: "https://example.com/dashboard",
        pathname: "/dashboard",
        title: "Dashboard",
      },
    });

    assert.strictEqual(summary.connected, true);
    assert.strictEqual(summary.stale, false);
    assert.strictEqual(summary.tabCount, 1);
    assert.strictEqual(summary.page?.url, "https://example.com/dashboard");
    assert.deepEqual(summary.capabilities, ["run", "screenshot"]);
  });

  it("keeps extension metadata even when the heartbeat has no page", () => {
    const store = new BrowserSessionStore();

    const summary = store.recordExtensionHeartbeat({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      extensionName: "Kuma Picker Bridge",
      extensionVersion: "1.2.3",
      browserName: "chrome",
      source: "runtime:on-startup",
      lastSeenAt: new Date().toISOString(),
      page: null,
    });

    assert.strictEqual(summary.connected, false);
    assert.strictEqual(summary.extensionId, "abcdefghijklmnopabcdefghijklmnop");
    assert.strictEqual(summary.browserName, "chrome");
  });

  it("resolves targetTabIndex against the sorted live tab list", () => {
    const store = new BrowserSessionStore();
    const now = Date.now();

    store.registerHello(
      "browser-1",
      {
        role: "browser",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        extensionName: "Kuma Picker Bridge",
        extensionVersion: "1.2.3",
        browserName: "chrome",
      },
      () => {},
    );

    store.recordBrowserPresence("browser-1", {
      activeTabId: 11,
      source: "websocket:presence",
      lastSeenAt: new Date(now).toISOString(),
      visible: true,
      focused: true,
      page: {
        url: "https://example.com/first",
        pathname: "/first",
        title: "First",
      },
      capabilities: ["run", "screenshot"],
    });

    store.recordBrowserPresence("browser-1", {
      activeTabId: 22,
      source: "websocket:presence",
      lastSeenAt: new Date(now - 1_000).toISOString(),
      visible: true,
      focused: false,
      page: {
        url: "https://example.com/second",
        pathname: "/second",
        title: "Second",
      },
      capabilities: ["run", "screenshot"],
    });

    const matched = store.findMatchingSession({
      targetTabIndex: 2,
    });

    assert.strictEqual(matched?.tabId, 22);
    assert.strictEqual(matched?.page?.url, "https://example.com/second");
  });
});
