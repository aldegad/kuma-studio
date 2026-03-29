import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const BROWSER_COMMANDS_PATH = path.resolve(process.cwd(), "packages/browser-extension/background/browser-commands.js");
const DEBUGGER_PATH = path.resolve(process.cwd(), "packages/browser-extension/background/debugger.js");

function loadBrowserCommandsContext(overrides = {}) {
  const source = readFileSync(BROWSER_COMMANDS_PATH, "utf8");
  const context = {
    console,
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Promise,
    setTimeout,
    clearTimeout,
    waitForDelay: async () => {},
    ensureAutomationBridge: async () => {},
    invalidateAutomationBridge: () => {},
    sendMessageToTab: async () => ({ ok: true, result: null }),
    captureTargetTabScreenshot: async () => {
      throw new Error("Unexpected screenshot capture in test.");
    },
    cropTabScreenshot: async () => {
      throw new Error("Unexpected screenshot crop in test.");
    },
    reloadTargetTab: async () => {
      throw new Error("Unexpected reload in test.");
    },
    navigateTargetTab: async () => {
      throw new Error("Unexpected goto in test.");
    },
    executeDebuggerEvaluateCommand: async () => {
      throw new Error("Unexpected debugger evaluate call.");
    },
    shouldFallbackDebuggerEvaluate: () => false,
    ...overrides,
  };

  vm.runInNewContext(source, context, { filename: BROWSER_COMMANDS_PATH });
  return context;
}

function loadDebuggerContext({ chrome, ...overrides }) {
  const source = readFileSync(DEBUGGER_PATH, "utf8");
  const context = {
    console,
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    WeakSet,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    chrome,
    ...overrides,
  };

  vm.runInNewContext(source, context, { filename: DEBUGGER_PATH });
  return context;
}

describe("page.evaluate routing", () => {
  it("uses debugger-first evaluation when the debugger path succeeds", async () => {
    const executeDebuggerEvaluateCommand = vi.fn(async () => ({
      page: { url: "https://example.com" },
      value: "debugger-value",
      executionWorld: "main-world",
      evaluateBackend: "debugger",
    }));
    const context = loadBrowserCommandsContext({
      executeDebuggerEvaluateCommand,
    });

    const result = await context.executeBrowserCommand(
      { id: 7, url: "https://example.com", title: "Example" },
      { type: "playwright", action: "page.evaluate", kind: "function", source: "() => 'ok'", arg: null },
    );

    expect(result.value).toBe("debugger-value");
    expect(result.evaluateBackend).toBe("debugger");
    expect(executeDebuggerEvaluateCommand).toHaveBeenCalledTimes(1);
  });

  it("uses a narrow fallback for attach failures and marks the fallback explicitly", async () => {
    const executeDebuggerEvaluateCommand = vi.fn(async () => {
      throw new Error("Chrome DevTools or another debugger is already attached to this tab.");
    });
    const sendMessageToTab = vi.fn(async () => ({
      ok: true,
      result: {
        page: { url: "https://example.com" },
        value: "content-value",
        executionWorld: "content-script",
        evaluateBackend: "content-script",
      },
    }));
    const context = loadBrowserCommandsContext({
      executeDebuggerEvaluateCommand,
      shouldFallbackDebuggerEvaluate: (error) =>
        String(error?.message ?? error).includes("already attached"),
      sendMessageToTab,
    });

    const result = await context.executeBrowserCommand(
      { id: 8, url: "https://example.com", title: "Example" },
      { type: "playwright", action: "page.evaluate", kind: "function", source: "() => 'ok'", arg: null },
    );

    expect(result.value).toBe("content-value");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackFrom).toBe("debugger");
    expect(result.fallbackReason).toContain("already attached");
  });
});

describe("debugger evaluate execution", () => {
  it("serializes function evaluation results in the main world", async () => {
    const sendCommand = vi.fn(async (_target, method, params) => {
      if (method === "Runtime.enable") {
        return {};
      }
      if (method === "Runtime.evaluate") {
        expect(params.expression).toContain('evaluateBackend: "debugger"');
        expect(params.expression).toContain("return await ((arg) => ({ seen: arg.value, href: window.location.href }))");
        return {
          result: {
            value: {
              ok: true,
              page: {
                url: "https://example.com/app",
                pathname: "/app",
                title: "Example",
              },
              value: {
                seen: 42,
                href: "https://example.com/app",
              },
              executionWorld: "main-world",
              evaluateBackend: "debugger",
            },
          },
        };
      }

      throw new Error(`Unexpected debugger command: ${method}`);
    });
    const context = loadDebuggerContext({
      chrome: {
        debugger: {
          attach: vi.fn(async () => {}),
          sendCommand,
          detach: vi.fn(async () => {}),
        },
        tabs: {
          get: vi.fn(async () => ({
            id: 11,
            url: "https://example.com/app",
            title: "Example",
          })),
        },
      },
    });

    const result = await context.executeDebuggerEvaluateCommand(
      { id: 11, url: "https://example.com/app", title: "Example" },
      {
        kind: "function",
        source: "(arg) => ({ seen: arg.value, href: window.location.href })",
        arg: { value: 42 },
      },
    );

    expect(result.executionWorld).toBe("main-world");
    expect(result.evaluateBackend).toBe("debugger");
    expect(result.value).toEqual({
      seen: 42,
      href: "https://example.com/app",
    });
  });

  it("throws page exceptions instead of silently falling back", async () => {
    const context = loadDebuggerContext({
      chrome: {
        debugger: {
          attach: vi.fn(async () => {}),
          sendCommand: vi.fn(async (_target, method) => {
            if (method === "Runtime.enable") {
              return {};
            }
            if (method === "Runtime.evaluate") {
              return {
                result: {
                  value: {
                    ok: false,
                    exception: {
                      name: "Error",
                      message: "boom",
                    },
                    executionWorld: "main-world",
                    evaluateBackend: "debugger",
                  },
                },
              };
            }

            throw new Error(`Unexpected debugger command: ${method}`);
          }),
          detach: vi.fn(async () => {}),
        },
        tabs: {
          get: vi.fn(async () => ({
            id: 12,
            url: "https://example.com/app",
            title: "Example",
          })),
        },
      },
    });

    await expect(
      context.executeDebuggerEvaluateCommand(
        { id: 12, url: "https://example.com/app", title: "Example" },
        {
          kind: "expression",
          source: "(() => { throw new Error('boom'); })()",
          arg: null,
        },
      ),
    ).rejects.toThrow("boom");
  });
});
