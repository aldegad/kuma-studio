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
});
