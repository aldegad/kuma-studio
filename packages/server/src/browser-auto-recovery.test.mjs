import { assert, describe, it } from "vitest";

import {
  BROWSER_SESSION_AUTO_RETRY_DELAY_MS,
  FINAL_BROWSER_CONNECTION_FAILURE_MESSAGE,
  inferRecoveryUrlFromTargets,
  readBrowserSessionWithAutoRecovery,
  resolveCurrentPageUrl,
  runWithBrowserAutoRecovery,
  SCREENSHOT_AUTO_RETRY_DELAY_MS,
  URL_MATCH_AUTO_RETRY_DELAY_MS,
} from "./browser-auto-recovery.mjs";

describe("browser-auto-recovery", () => {
  it("infers recovery URL from explicit target URL", () => {
    assert.strictEqual(
      inferRecoveryUrlFromTargets(
        { targetUrl: "https://example.com/page" },
        "http://127.0.0.1:4312",
      ),
      "https://example.com/page",
    );
  });

  it("infers recovery URL from url-contains when it looks like a domain", () => {
    assert.strictEqual(
      inferRecoveryUrlFromTargets(
        { targetUrlContains: "example.com/path" },
        "http://127.0.0.1:4312",
      ),
      "https://example.com/path",
    );
  });

  it("falls back to the studio page when no target URL is available", () => {
    assert.strictEqual(
      inferRecoveryUrlFromTargets({}, "http://127.0.0.1:4312"),
      "http://127.0.0.1:4312/studio",
    );
  });

  it("uses the active browser session page URL for image readback recovery", async () => {
    const url = await resolveCurrentPageUrl({
      daemonUrl: "http://127.0.0.1:4312",
      targets: { targetUrlContains: "example.com" },
      readBrowserSessionSummaryFn: async () => ({
        page: {
          url: "https://current.example.com/live",
        },
      }),
    });

    assert.strictEqual(url, "https://current.example.com/live");
  });

  it("retries after auto-opening the browser on missing connection", async () => {
    const openedUrls = [];
    const delays = [];
    const logs = [];
    let attempts = 0;

    const result = await runWithBrowserAutoRecovery({
      daemonUrl: "http://127.0.0.1:4312",
      targets: { targetUrlContains: "example.com/path" },
      execute: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("No active browser connection is available.");
        }
        return "ok";
      },
      openBrowserFn: (url) => openedUrls.push(url),
      delayFn: async (ms) => delays.push(ms),
      logFn: (message) => logs.push(message),
    });

    assert.strictEqual(result, "ok");
    assert.deepEqual(openedUrls, ["https://example.com/path"]);
    assert.deepEqual(delays, [5_000]);
    assert.strictEqual(logs[0], "No browser connection. Auto-opening browser and retrying... (attempt 2/3)");
  });

  it("retries image readback failures by reopening the current page", async () => {
    const openedUrls = [];
    const delays = [];
    let attempts = 0;

    const result = await runWithBrowserAutoRecovery({
      daemonUrl: "http://127.0.0.1:4312",
      targets: { targetUrl: "https://fallback.example.com" },
      allowImageReadbackRetry: true,
      execute: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("image readback failed");
        }
        return "ok";
      },
      openBrowserFn: (url) => openedUrls.push(url),
      delayFn: async (ms) => delays.push(ms),
      readBrowserSessionSummaryFn: async () => ({
        page: {
          url: "https://current.example.com/page",
        },
      }),
      logFn: () => {},
    });

    assert.strictEqual(result, "ok");
    assert.deepEqual(openedUrls, ["https://current.example.com/page"]);
    assert.deepEqual(delays, [SCREENSHOT_AUTO_RETRY_DELAY_MS]);
  });

  it("auto-opens a matching URL when url-contains does not resolve to an existing tab", async () => {
    const openedUrls = [];
    const delays = [];
    let attempts = 0;

    const result = await runWithBrowserAutoRecovery({
      daemonUrl: "http://127.0.0.1:4312",
      targets: { targetUrlContains: "studio" },
      execute: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("No browser tab matches the requested URL fragment: studio");
        }
        return "ok";
      },
      openBrowserFn: (url) => openedUrls.push(url),
      delayFn: async (ms) => delays.push(ms),
      logFn: () => {},
    });

    assert.strictEqual(result, "ok");
    assert.deepEqual(openedUrls, ["http://127.0.0.1:4312/studio"]);
    assert.deepEqual(delays, [URL_MATCH_AUTO_RETRY_DELAY_MS]);
  });

  it("retries get-browser-session by auto-opening the browser when the session is disconnected", async () => {
    const openedUrls = [];
    const delays = [];
    let attempts = 0;

    const session = await readBrowserSessionWithAutoRecovery({
      daemonUrl: "http://127.0.0.1:4312",
      targets: { targetUrl: "https://example.com/dashboard" },
      readBrowserSessionSummaryFn: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            connected: false,
            message: "No active Kuma Picker browser session is available.",
          };
        }

        return {
          connected: true,
          page: { url: "https://example.com/dashboard" },
        };
      },
      openBrowserFn: (url) => openedUrls.push(url),
      delayFn: async (ms) => delays.push(ms),
      logFn: () => {},
    });

    assert.strictEqual(session?.connected, true);
    assert.deepEqual(openedUrls, ["https://example.com/dashboard"]);
    assert.deepEqual(delays, [BROWSER_SESSION_AUTO_RETRY_DELAY_MS]);
  });

  it("throws the final browser connection failure message after three attempts", async () => {
    try {
      await runWithBrowserAutoRecovery({
        daemonUrl: "http://127.0.0.1:4312",
        targets: {},
        execute: async () => {
          throw new Error("No active browser connection is available.");
        },
        openBrowserFn: () => {},
        delayFn: async () => {},
        logFn: () => {},
      });
      assert.fail("Expected runWithBrowserAutoRecovery to throw.");
    } catch (error) {
      assert.instanceOf(error, Error);
      assert.strictEqual(error.message, FINAL_BROWSER_CONNECTION_FAILURE_MESSAGE);
    }
  });
});
