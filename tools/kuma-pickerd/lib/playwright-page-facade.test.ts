import { describe, expect, it, vi } from "vitest";

import { createPage, createPageState } from "./playwright-page-facade.mjs";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9gnS0AAAAASUVORK5CYII=";

function createClientStub(sendImpl) {
  return {
    send: vi.fn(sendImpl),
  };
}

describe("playwright page facade", () => {
  it("keeps page.url null until the browser reports a page record", () => {
    const page = createPage(createClientStub(async () => null), createPageState());

    expect(page.url()).toBeNull();
  });

  it("fails fast when mouse.down has no explicit coordinates and no prior mouse move", async () => {
    const client = createClientStub(async () => ({ page: { url: "https://example.com" } }));
    const page = createPage(client, createPageState());

    await expect(page.mouse.down()).rejects.toThrow(/page\.mouse\.down requires x\/y coordinates/i);
    expect(client.send).not.toHaveBeenCalled();
  });

  it("fails fast when mouse.up has no explicit coordinates and no prior mouse move", async () => {
    const client = createClientStub(async () => ({ page: { url: "https://example.com" } }));
    const page = createPage(client, createPageState());

    await expect(page.mouse.up()).rejects.toThrow(/page\.mouse\.up requires x\/y coordinates/i);
    expect(client.send).not.toHaveBeenCalled();
  });

  it("rejects invalid clip rectangles instead of silently falling back to a full-page screenshot", async () => {
    const client = createClientStub(async () => ({
      page: { url: "https://example.com" },
      screenshot: { dataUrl: PNG_DATA_URL },
    }));
    const page = createPage(client, createPageState());

    await expect(
      page.screenshot({
        clip: { x: 10, y: 20, width: Number.NaN, height: 50 },
      }),
    ).rejects.toThrow(/page\.screenshot clip requires finite x, y, width, and height values/i);
    expect(client.send).not.toHaveBeenCalled();
  });

  it("rejects locator screenshots when the target cannot be measured", async () => {
    const client = createClientStub(async (action) => {
      if (action === "locator.measure") {
        return {
          page: { url: "https://example.com" },
          rect: null,
        };
      }

      return {
        page: { url: "https://example.com" },
        screenshot: { dataUrl: PNG_DATA_URL },
      };
    });
    const page = createPage(client, createPageState());

    await expect(page.locator("#hero").screenshot()).rejects.toThrow(/locator\.screenshot requires a measurable target rect/i);
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith("locator.measure", {
      locator: {
        kind: "selector",
        selector: "#hero",
      },
    });
  });

  it("passes role name matching through the locator descriptor", async () => {
    const client = createClientStub(async () => ({ page: { url: "https://example.com" } }));
    const page = createPage(client, createPageState());

    await page.getByRole("button", { name: "Download" }).click();

    expect(client.send).toHaveBeenCalledWith(
      "locator.click",
      {
        locator: {
          kind: "role",
          role: "button",
          name: "Download",
          exact: false,
        },
      },
      { timeoutMs: undefined },
    );
  });

  it("supports locator nth chaining with Playwright-style zero-based indices", async () => {
    const client = createClientStub(async () => ({ page: { url: "https://example.com" } }));
    const page = createPage(client, createPageState());

    await page.getByText("+ URI 추가").nth(1).click();

    expect(client.send).toHaveBeenCalledWith(
      "locator.click",
      {
        locator: {
          kind: "text",
          text: "+ URI 추가",
          exact: false,
          nth: 1,
        },
      },
      { timeoutMs: undefined },
    );
  });

  it("supports locator first and last helpers", async () => {
    const client = createClientStub(async () => ({ page: { url: "https://example.com" } }));
    const page = createPage(client, createPageState());

    await page.locator(".download").first().click();
    await page.locator(".download").last().click();

    expect(client.send).toHaveBeenNthCalledWith(
      1,
      "locator.click",
      {
        locator: {
          kind: "selector",
          selector: ".download",
          nth: 0,
        },
      },
      { timeoutMs: undefined },
    );
    expect(client.send).toHaveBeenNthCalledWith(
      2,
      "locator.click",
      {
        locator: {
          kind: "selector",
          selector: ".download",
          nth: "last",
        },
      },
      { timeoutMs: undefined },
    );
  });

  it("supports page.mouse.click for coordinate-based clicks", async () => {
    const client = createClientStub(async () => ({ page: { url: "https://example.com" } }));
    const page = createPage(client, createPageState());

    await page.mouse.click(320, 240);

    expect(client.send).toHaveBeenCalledWith(
      "mouse.click",
      {
        x: 320,
        y: 240,
        button: "left",
      },
      { timeoutMs: undefined },
    );
  });

  it("writes a warning when page.evaluate falls back from debugger execution", async () => {
    const client = createClientStub(async () => ({
      page: { url: "https://example.com" },
      value: "hello",
      fallbackUsed: true,
      fallbackReason: "Chrome DevTools or another debugger is already attached to this tab.",
      evaluateBackend: "content-script",
    }));
    const page = createPage(client, createPageState());
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const chunks = [];
    process.stderr.write = ((chunk, encoding, callback) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === "string" ? encoding : undefined) : String(chunk));
      if (typeof encoding === "function") {
        encoding();
      } else if (typeof callback === "function") {
        callback();
      }
      return true;
    });

    try {
      await expect(page.evaluate(() => "hello")).resolves.toBe("hello");
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    expect(chunks.join("")).toContain("page.evaluate fell back to content-script");
  });
});
