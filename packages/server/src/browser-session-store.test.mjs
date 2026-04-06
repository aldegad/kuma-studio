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
});
