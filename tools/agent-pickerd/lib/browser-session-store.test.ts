import { describe, expect, it } from "vitest";

describe("BrowserSessionStore", () => {
  it("tracks the latest heartbeat summary", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();

    const before = store.readSummary();
    expect(before.connected).toBe(false);
    expect(before.capabilities).toEqual([]);

    const summary = store.heartbeat({
      extensionId: "ext-1",
      extensionName: "Agent Picker Bridge",
      extensionVersion: "0.1.0",
      browserName: "chrome",
      page: {
        url: "https://developers.portone.io/opi/ko/integration/start/v2/readme?v=v2",
        pathname: "/opi/ko/integration/start/v2/readme",
        title: "PortOne Docs",
      },
      activeTabId: 42,
      capabilities: ["context", "click", "dom"],
    });

    expect(summary.connected).toBe(true);
    expect(summary.page?.title).toBe("PortOne Docs");
    expect(summary.activeTabId).toBe(42);
    expect(summary.capabilities).toEqual(["context", "click", "dom"]);
  });

  it("queues, claims, and completes browser commands", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();

    const command = store.enqueueCommand({
      type: "click",
      selector: "button.primary",
      postActionDelayMs: 300,
    });

    expect(command.status).toBe("pending");
    expect(command.selector).toBe("button.primary");

    const claimed = store.claimNextCommand({
      tabId: 1,
      url: "https://example.com",
      visible: true,
      focused: true,
    });
    expect(claimed?.id).toBe(command.id);
    expect(claimed?.status).toBe("claimed");

    const completed = store.completeCommand(command.id, {
      ok: true,
      result: {
        page: {
          title: "Updated Page",
        },
      },
    });

    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({
      page: {
        title: "Updated Page",
      },
    });
  });

  it("matches targeted commands to background tabs by url or tab id", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();

    const byUrl = store.enqueueCommand({
      type: "click",
      text: "Continue",
      targetUrlContains: "developers.portone.io",
    });
    const byTab = store.enqueueCommand({
      type: "dom",
      targetTabId: 77,
    });

    expect(
      store.claimNextCommand({
        tabId: 55,
        url: "https://developers.portone.io/opi/ko/integration/start/v2/readme?v=v2",
        visible: false,
        focused: false,
      })?.id,
    ).toBe(byUrl.id);

    expect(
      store.claimNextCommand({
        tabId: 77,
        url: "https://example.com/background",
        visible: false,
        focused: false,
      })?.id,
    ).toBe(byTab.id);
  });

  it("stores fill and click-point command payloads for later execution", async () => {
    const { BrowserSessionStore } = await import("./browser-session-store.mjs");
    const store = new BrowserSessionStore();

    const fillCommand = store.enqueueCommand({
      type: "fill",
      value: "https://ddalkkakposting.com/privacy",
      selector: "input[name='privacy']",
    });
    const pointCommand = store.enqueueCommand({
      type: "click-point",
      x: 180.7,
      y: 220.4,
    });

    expect(fillCommand.value).toBe("https://ddalkkakposting.com/privacy");
    expect(fillCommand.selector).toBe("input[name='privacy']");
    expect(pointCommand.x).toBe(181);
    expect(pointCommand.y).toBe(220);
  });
});
