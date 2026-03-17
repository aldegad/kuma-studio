import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

interface BrowserExtensionStatusStoreModule {
  BrowserExtensionStatusStore: new (root: string) => {
    readSummary(options?: { now?: number; staleAfterMs?: number }): {
      detected: boolean;
      active: boolean;
      status: string;
      lastSeenAgoMs: number | null;
      extensionId: string | null;
      browserTransport?: string;
      socketConnected?: boolean;
      lastSocketError?: string | null;
      lastPage: {
        title: string | null;
        url: string | null;
      } | null;
      message: string;
    };
    write(record: unknown): {
      extensionId: string;
      firstSeenAt: string;
      lastSeenAt: string;
      lastSource: string;
    };
  };
}

describe("BrowserExtensionStatusStore", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete process.env.AGENT_PICKER_STATE_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an unseen summary before any extension presence is stored", async () => {
    // @ts-expect-error local .mjs helper is runtime-tested here and has no native TS declaration.
    const { BrowserExtensionStatusStore } = (await import("./browser-extension-status-store.mjs")) as BrowserExtensionStatusStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "browser-extension-status-store-"));
    tempRoots.push(root);
    process.env.AGENT_PICKER_STATE_HOME = path.join(root, "state");

    const store = new BrowserExtensionStatusStore(root);
    const summary = store.readSummary();

    expect(summary.detected).toBe(false);
    expect(summary.active).toBe(false);
    expect(summary.status).toBe("unseen");
    expect(summary.message).toContain("No Agent Picker browser extension presence");
  });

  it("tracks the latest presence update and marks stale entries as seen", async () => {
    // @ts-expect-error local .mjs helper is runtime-tested here and has no native TS declaration.
    const { BrowserExtensionStatusStore } = (await import("./browser-extension-status-store.mjs")) as BrowserExtensionStatusStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "browser-extension-status-store-"));
    tempRoots.push(root);
    process.env.AGENT_PICKER_STATE_HOME = path.join(root, "state");

    const store = new BrowserExtensionStatusStore(root);
    const initial = store.write({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      extensionName: "Agent Picker Bridge",
      extensionVersion: "0.1.0",
      browserName: "chrome",
      source: "content-script:page-ready",
      page: {
        url: "https://example.com/dashboard",
        pathname: "/dashboard",
        title: "Dashboard",
      },
      lastSeenAt: "2026-03-16T09:00:00.000Z",
    });

    const updated = store.write({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      source: "popup:test-daemon",
      lastSeenAt: "2026-03-16T09:04:00.000Z",
    });

    const activeSummary = store.readSummary({
      now: Date.parse("2026-03-16T09:06:00.000Z"),
      staleAfterMs: 5 * 60 * 1000,
    });
    const staleSummary = store.readSummary({
      now: Date.parse("2026-03-16T09:12:00.000Z"),
      staleAfterMs: 5 * 60 * 1000,
    });

    expect(updated.firstSeenAt).toBe(initial.firstSeenAt);
    expect(updated.lastSeenAt).toBe("2026-03-16T09:04:00.000Z");
    expect(updated.lastSource).toBe("popup:test-daemon");
    expect(activeSummary.detected).toBe(true);
    expect(activeSummary.active).toBe(true);
    expect(activeSummary.status).toBe("active");
    expect(activeSummary.extensionId).toBe("abcdefghijklmnopabcdefghijklmnop");
    expect(activeSummary.browserTransport).toBe("unknown");
    expect(activeSummary.socketConnected).toBe(false);
    expect(activeSummary.lastPage?.title).toBe("Dashboard");
    expect(staleSummary.active).toBe(false);
    expect(staleSummary.status).toBe("seen");
    expect(staleSummary.lastSeenAgoMs).toBe(8 * 60 * 1000);
  });

  it("persists websocket diagnostics from the extension runtime", async () => {
    // @ts-expect-error local .mjs helper is runtime-tested here and has no native TS declaration.
    const { BrowserExtensionStatusStore } = (await import("./browser-extension-status-store.mjs")) as BrowserExtensionStatusStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "browser-extension-status-store-"));
    tempRoots.push(root);
    process.env.AGENT_PICKER_STATE_HOME = path.join(root, "state");

    const store = new BrowserExtensionStatusStore(root);
    store.write({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      browserTransport: "websocket",
      socketConnected: false,
      lastSocketError: "The Agent Picker WebSocket bridge failed to initialize.",
      lastSocketErrorAt: "2026-03-16T09:04:30.000Z",
    });

    const summary = store.readSummary();
    expect(summary.browserTransport).toBe("websocket");
    expect(summary.socketConnected).toBe(false);
    expect(summary.lastSocketError).toContain("failed to initialize");
  });
});
