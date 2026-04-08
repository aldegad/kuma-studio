import { assert, describe, it } from "vitest";

import { createPage, createPageState } from "./playwright-page-facade.mjs";

describe("playwright-page-facade", () => {
  it("falls back to page.goto when page.reload fails on a stale browser connection", async () => {
    const calls = [];
    const client = {
      async send(action, payload, options) {
        calls.push({ action, payload, options });

        if (action === "page.reload") {
          throw new Error(
            "No active browser connection is available. Try page.goto() instead of page.reload() for stale connections.",
          );
        }

        return {
          page: {
            url: payload.url,
            pathname: "/studio",
            title: "Studio",
          },
          status: "complete",
        };
      },
    };

    const state = createPageState();
    state.url = "https://example.com/studio";

    const page = createPage(client, state);
    const result = await page.reload({ waitUntil: "networkidle", timeout: 9_000 });

    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0], {
      action: "page.reload",
      payload: { bypassCache: false },
      options: { timeoutMs: 9_000 },
    });
    assert.deepStrictEqual(calls[1], {
      action: "page.goto",
      payload: { url: "https://example.com/studio", waitUntil: "networkidle" },
      options: { timeoutMs: 9_000 },
    });
    assert.strictEqual(result?.page?.url, "https://example.com/studio");
    assert.strictEqual(state.url, "https://example.com/studio");
  });
});
