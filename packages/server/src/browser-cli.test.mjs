import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, assert, describe, it } from "vitest";

import {
  commandBrowserListTabs,
  commandBrowserScreenshot,
  commandBrowserScreenshotDiff,
  commandBrowserStudioSnapshot,
  commandBrowserType,
  commandBrowserWaitFor,
} from "./browser-cli.mjs";
import { decodePng, encodePng } from "./png-utils.mjs";

const tempDirs = [];

function createPngBuffer(width, height, colorAt) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b, a] = colorAt(x, y);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }

  return encodePng({ width, height, data });
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("browser-cli", () => {
  it("creates missing screenshot directories before writing the file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kuma-browser-cli-"));
    tempDirs.push(tempDir);

    const filePath = join(tempDir, "nested", "screenshots", "picker-check.png");
    const stdoutChunks = [];
    let clientClosed = false;

    await commandBrowserScreenshot(
      {
        file: filePath,
      },
      {
        clientFactory: () => ({
          async send() {
            return {
              screenshot: {
                base64: Buffer.from("picker screenshot", "utf8").toString("base64"),
                mimeType: "image/png",
                capturedAt: "2026-04-08T00:00:00.000Z",
                tabId: 17,
                windowId: 3,
              },
              page: {
                url: "https://example.com/studio",
              },
            };
          },
          async close() {
            clientClosed = true;
          },
        }),
        runWithBrowserAutoRecoveryFn: async ({ execute }) => execute(),
        stdout: {
          write(chunk) {
            stdoutChunks.push(String(chunk));
          },
        },
      },
    );

    const savedScreenshot = await readFile(filePath, "utf8");
    assert.strictEqual(savedScreenshot, "picker screenshot");
    assert.strictEqual(clientClosed, true);
    assert.match(stdoutChunks.join(""), /"file":\s*".*picker-check\.png"/u);
  });

  it("hides overlays before taking a screenshot when --hide-overlay is requested", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kuma-browser-cli-"));
    tempDirs.push(tempDir);

    const filePath = join(tempDir, "overlay-hidden.png");
    const stdoutChunks = [];
    const calls = [];

    await commandBrowserScreenshot(
      {
        file: filePath,
        "hide-overlay": true,
        "tab-index": "1",
      },
      {
        clientFactory: () => ({
          async send(action, payload) {
            calls.push({ action, payload });
            if (action === "page.screenshot") {
              return {
                screenshot: {
                  base64: Buffer.from("overlay hidden screenshot", "utf8").toString("base64"),
                  mimeType: "image/png",
                },
              };
            }

            return {
              value: true,
            };
          },
          async close() {},
        }),
        runWithBrowserAutoRecoveryFn: async ({ execute }) => execute(),
        stdout: {
          write(chunk) {
            stdoutChunks.push(String(chunk));
          },
        },
      },
    );

    assert.deepEqual(
      calls.map((entry) => entry.action),
      ["page.evaluate", "page.screenshot", "page.evaluate"],
    );
    assert.strictEqual(calls[0]?.payload?.arg?.hidden, true);
    assert.strictEqual(calls[2]?.payload?.arg?.hidden, false);

    const output = JSON.parse(stdoutChunks.join(""));
    assert.strictEqual(output.hideOverlay, true);
  });

  it("lists browser tabs with human-friendly tab indexes", async () => {
    const stdoutChunks = [];

    await commandBrowserListTabs(
      {},
      {
        readBrowserSessionWithAutoRecoveryFn: async () => ({
          connected: true,
          stale: false,
          tabs: [
            {
              tabId: 11,
              page: {
                url: "https://example.com/a",
                title: "Tab A",
              },
              visible: true,
              focused: true,
              lastSeenAt: "2026-04-08T00:00:00.000Z",
            },
            {
              tabId: 12,
              page: {
                url: "https://example.com/b",
                title: "Tab B",
              },
              visible: false,
              focused: false,
              lastSeenAt: "2026-04-08T00:00:01.000Z",
            },
          ],
        }),
        stdout: {
          write(chunk) {
            stdoutChunks.push(String(chunk));
          },
        },
      },
    );

    const output = JSON.parse(stdoutChunks.join(""));
    assert.strictEqual(output.tabCount, 2);
    assert.deepEqual(output.tabs[0], {
      tabIndex: 1,
      tabId: 11,
      url: "https://example.com/a",
      title: "Tab A",
      visible: true,
      focused: true,
      lastSeenAt: "2026-04-08T00:00:00.000Z",
    });
    assert.strictEqual(output.tabs[1].tabIndex, 2);
  });

  it("waits for a selector through the browser automation client", async () => {
    const stdoutChunks = [];
    const calls = [];

    await commandBrowserWaitFor(
      {
        selector: "#submit",
        "tab-index": "2",
        "timeout-ms": "2500",
        state: "attached",
      },
      {
        clientFactory: () => ({
          async send(action, payload, options) {
            calls.push({ action, payload, options });
            return {
              page: {
                url: "https://example.com/form",
              },
            };
          },
          async close() {},
        }),
        runWithBrowserAutoRecoveryFn: async ({ execute }) => execute(),
        stdout: {
          write(chunk) {
            stdoutChunks.push(String(chunk));
          },
        },
      },
    );

    assert.deepEqual(calls, [
      {
        action: "page.waitForSelector",
        payload: {
          selector: "#submit",
          state: "attached",
        },
        options: {
          timeoutMs: 2500,
        },
      },
    ]);

    const output = JSON.parse(stdoutChunks.join(""));
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.selector, "#submit");
    assert.strictEqual(output.state, "attached");
    assert.strictEqual(output.timeoutMs, 2500);
  });

  it("types text by focusing the target element and sending keyboard events", async () => {
    const calls = [];

    await commandBrowserType(
      {
        selector: "#editor",
        text: "hello",
        "tab-index": "1",
        "timeout-ms": "3000",
        "delay-ms": "25",
      },
      {
        clientFactory: () => ({
          async send(action, payload, options) {
            calls.push({ action, payload, options });
            return {
              page: {
                url: "https://example.com/editor",
              },
            };
          },
          async close() {},
        }),
        runWithBrowserAutoRecoveryFn: async ({ execute }) => execute(),
        stdout: {
          write() {},
        },
      },
    );

    assert.deepEqual(calls, [
      {
        action: "locator.focus",
        payload: {
          locator: {
            kind: "selector",
            selector: "#editor",
          },
        },
        options: {
          timeoutMs: 3000,
        },
      },
      {
        action: "keyboard.type",
        payload: {
          text: "hello",
          delay: 25,
        },
        options: {
          timeoutMs: 3000,
        },
      },
    ]);
  });

  it("fills text directly when --fill is requested", async () => {
    const calls = [];

    await commandBrowserType(
      {
        selector: "#query",
        text: "vault",
        "tab-index": "1",
        fill: true,
      },
      {
        clientFactory: () => ({
          async send(action, payload, options) {
            calls.push({ action, payload, options });
            return {
              page: {
                url: "https://example.com/search",
              },
            };
          },
          async close() {},
        }),
        runWithBrowserAutoRecoveryFn: async ({ execute }) => execute(),
        stdout: {
          write() {},
        },
      },
    );

    assert.deepEqual(calls, [
      {
        action: "locator.fill",
        payload: {
          locator: {
            kind: "selector",
            selector: "#query",
          },
          value: "vault",
        },
        options: {
          timeoutMs: 15000,
        },
      },
    ]);
  });

  it("captures a studio snapshot with screenshot, DOM, and runtime console entries", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kuma-browser-cli-"));
    tempDirs.push(tempDir);

    const filePath = join(tempDir, "studio-snapshot.png");
    const stdoutChunks = [];
    const screenshotBuffer = createPngBuffer(2, 1, (x) => (x === 0 ? [30, 40, 50, 255] : [60, 70, 80, 255]));
    const calls = [];

    await commandBrowserStudioSnapshot(
      {
        file: filePath,
        "hide-overlay": true,
        "url-contains": "studio",
      },
      {
        clientFactory: () => ({
          async send(action, payload) {
            calls.push({ action, payload });
            if (action === "page.screenshot") {
              return {
                screenshot: {
                  base64: screenshotBuffer.toString("base64"),
                  mimeType: "image/png",
                },
              };
            }
            if (action === "page.content") {
              return {
                html: "<main><section>studio ui</section></main>",
              };
            }
            if (action === "page.evaluate" && payload?.arg?.hidden === undefined) {
              return {
                value: {
                  entries: [
                    {
                      type: "console",
                      level: "warn",
                      message: "cache miss",
                    },
                    {
                      type: "unhandledrejection",
                      level: "error",
                      message: "Boom",
                    },
                  ],
                },
              };
            }

            return {
              value: true,
            };
          },
          async close() {},
        }),
        runWithBrowserAutoRecoveryFn: async ({ execute }) => execute(),
        stdout: {
          write(chunk) {
            stdoutChunks.push(String(chunk));
          },
        },
      },
    );

    assert.deepEqual(
      calls.map((entry) => entry.action),
      ["page.evaluate", "page.screenshot", "page.evaluate", "page.content", "page.evaluate"],
    );

    const savedScreenshot = await readFile(filePath);
    assert.deepEqual(savedScreenshot, screenshotBuffer);

    const output = JSON.parse(stdoutChunks.join(""));
    assert.strictEqual(output.screenshot, screenshotBuffer.toString("base64"));
    assert.strictEqual(output.dom, "<main><section>studio ui</section></main>");
    assert.deepEqual(output.console, ["[warn] cache miss", "[error] unhandledrejection: Boom"]);
  });

  it("creates a PNG diff and highlights the changed region", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kuma-browser-cli-"));
    tempDirs.push(tempDir);

    const beforePath = join(tempDir, "before.png");
    const currentPath = join(tempDir, "current.png");
    const diffPath = join(tempDir, "nested", "diff.png");
    const stdoutChunks = [];
    const beforeBuffer = createPngBuffer(2, 2, () => [255, 255, 255, 255]);
    const currentBuffer = createPngBuffer(2, 2, (x, y) => (x === 1 && y === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));

    await writeFile(beforePath, beforeBuffer);

    await commandBrowserScreenshotDiff(
      {
        before: beforePath,
        file: currentPath,
        "diff-file": diffPath,
        "tab-index": "1",
      },
      {
        clientFactory: () => ({
          async send(action) {
            if (action === "page.screenshot") {
              return {
                screenshot: {
                  base64: currentBuffer.toString("base64"),
                  mimeType: "image/png",
                },
              };
            }

            throw new Error(`Unexpected action ${action}`);
          },
          async close() {},
        }),
        runWithBrowserAutoRecoveryFn: async ({ execute }) => execute(),
        stdout: {
          write(chunk) {
            stdoutChunks.push(String(chunk));
          },
        },
      },
    );

    const currentScreenshot = await readFile(currentPath);
    assert.deepEqual(currentScreenshot, currentBuffer);

    const diffOutput = JSON.parse(stdoutChunks.join(""));
    assert.strictEqual(diffOutput.changedPixels, 1);
    assert.deepEqual(diffOutput.changedBounds, { x: 1, y: 0, width: 1, height: 1 });
    assert.strictEqual(diffOutput.diff, diffPath);

    const diffBuffer = await readFile(diffPath);
    const diffImage = decodePng(diffBuffer);
    const changedOffset = (0 * diffImage.width + 1) * 4;
    assert.deepEqual(Array.from(diffImage.data.slice(changedOffset, changedOffset + 4)), [255, 0, 0, 255]);
  });
});
