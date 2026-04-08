import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AutomationClient, getDaemonUrlFromOptions, readTargetOptions } from "./automation-client.mjs";
import { readBrowserSessionWithAutoRecovery, runWithBrowserAutoRecovery } from "./browser-auto-recovery.mjs";
import { readNumber, readOptionalString, requireString } from "./cli-options.mjs";
import { decodePng, diffRgbaImages, encodePng } from "./png-utils.mjs";
import { serializeEvaluateInput } from "./playwright-runner-support.mjs";

const DEFAULT_BROWSER_SCREENSHOT_PATH = "/tmp/kuma-studio-screenshot.png";
const DEFAULT_BROWSER_SCREENSHOT_DIFF_PATH = "/tmp/kuma-studio-screenshot-diff.png";
const KUMA_OVERLAY_STYLE_ID = "__kuma_picker_hide_overlay_style__";
const KUMA_OVERLAY_HIDE_CSS = [
  "[data-kuma-agent-overlay]",
  ".tooltip-enter",
  ".working-progress-bar",
].join(", ") + "{display:none !important; visibility:hidden !important; opacity:0 !important; animation:none !important;}";

function createAutomationClient(clientFactory, clientOptions) {
  return (clientFactory ?? ((nextClientOptions) => new AutomationClient(nextClientOptions)))(clientOptions);
}

function createSelectorLocator(selector) {
  return {
    kind: "selector",
    selector,
  };
}

function normalizeWaitState(value) {
  const state = typeof value === "string" && value.trim() ? value.trim() : "visible";
  if (!["attached", "detached", "hidden", "visible"].includes(state)) {
    throw new Error("--state must be one of: attached, detached, hidden, visible.");
  }

  return state;
}

function formatSessionTabs(session) {
  const tabs = Array.isArray(session?.tabs) ? session.tabs : [];
  return tabs.map((tab, index) => ({
    tabIndex: index + 1,
    tabId: tab?.tabId ?? null,
    url: tab?.page?.url ?? null,
    title: tab?.page?.title ?? null,
    visible: tab?.visible === true,
    focused: tab?.focused === true,
    lastSeenAt: tab?.lastSeenAt ?? null,
  }));
}

function shouldHideOverlay(options) {
  return options["hide-overlay"] === true;
}

function formatRuntimeConsoleEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const level = typeof entry.level === "string" && entry.level.trim() ? entry.level.trim() : null;
  const type = typeof entry.type === "string" && entry.type.trim() ? entry.type.trim() : null;
  const message = typeof entry.message === "string" && entry.message.trim()
    ? entry.message.trim()
    : (() => {
        const details = entry.args ?? entry.reason ?? entry.error ?? null;
        if (details == null) {
          return null;
        }

        try {
          return JSON.stringify(details);
        } catch {
          return String(details);
        }
      })();

  if (!message) {
    return null;
  }

  const segments = [];
  if (level) {
    segments.push(`[${level}]`);
  }
  if (type && type !== "console") {
    segments.push(`${type}:`);
  }
  segments.push(message);
  return segments.join(" ");
}

function normalizeRuntimeConsoleEntries(value) {
  const entries = Array.isArray(value?.entries) ? value.entries : Array.isArray(value) ? value : [];
  return entries.map((entry) => formatRuntimeConsoleEntry(entry)).filter(Boolean);
}

async function setOverlayHidden(client, hidden, timeoutMs) {
  await client.send(
    "page.evaluate",
    serializeEvaluateInput(
      ({ styleId, css, hidden: nextHidden }) => {
        const existing = document.getElementById(styleId);
        if (!nextHidden) {
          existing?.remove();
          return false;
        }

        if (existing) {
          existing.textContent = css;
          return true;
        }

        const style = document.createElement("style");
        style.id = styleId;
        style.setAttribute("data-kuma-picker-overlay-style", "true");
        style.textContent = css;
        document.documentElement.appendChild(style);
        return true;
      },
      {
        styleId: KUMA_OVERLAY_STYLE_ID,
        css: KUMA_OVERLAY_HIDE_CSS,
        hidden,
      },
    ),
    {
      timeoutMs,
    },
  );
}

async function withOptionalOverlayHidden(client, hideOverlay, timeoutMs, execute) {
  if (!hideOverlay) {
    return execute();
  }

  await setOverlayHidden(client, true, timeoutMs);
  try {
    return await execute();
  } finally {
    try {
      await setOverlayHidden(client, false, timeoutMs);
    } catch {
      // Ignore cleanup failures so the original error remains visible.
    }
  }
}

async function captureScreenshotResult({
  client,
  daemonUrl,
  targets,
  timeoutMs,
  hideOverlay = false,
  runWithBrowserAutoRecoveryFn = runWithBrowserAutoRecovery,
} = {}) {
  return runWithBrowserAutoRecoveryFn({
    daemonUrl,
    targets,
    allowImageReadbackRetry: true,
    execute: () =>
      withOptionalOverlayHidden(client, hideOverlay, timeoutMs, () =>
        client.send(
          "page.screenshot",
          {
            ...targets,
          },
          {
            timeoutMs,
          },
        )),
  });
}

export async function commandGetBrowserSession(options, deps = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = readTargetOptions(options);
  const readBrowserSessionWithAutoRecoveryFn =
    deps.readBrowserSessionWithAutoRecoveryFn ?? readBrowserSessionWithAutoRecovery;
  const stdout = deps.stdout ?? process.stdout;
  const session = await readBrowserSessionWithAutoRecoveryFn({
    daemonUrl,
    targets,
  });
  stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}

function decodeScreenshotBase64(result) {
  const screenshot = result?.screenshot ?? result ?? null;
  if (typeof screenshot?.base64 === "string" && screenshot.base64) {
    return {
      base64: screenshot.base64,
      mimeType: screenshot.mimeType ?? "image/png",
      capturedAt: screenshot.capturedAt ?? null,
      page: result?.page ?? null,
      tabId: screenshot.tabId ?? result?.tabId ?? null,
      windowId: screenshot.windowId ?? result?.windowId ?? null,
    };
  }

  const dataUrl =
    typeof screenshot === "string" ? screenshot : typeof screenshot?.dataUrl === "string" ? screenshot.dataUrl : null;
  const matched = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl ?? "");
  if (!matched) {
    throw new Error("Screenshot result did not include base64 image data.");
  }

  return {
    base64: matched[2],
    mimeType: matched[1] || "image/png",
    capturedAt: screenshot?.capturedAt ?? null,
    page: result?.page ?? null,
    tabId: screenshot?.tabId ?? result?.tabId ?? null,
    windowId: screenshot?.windowId ?? result?.windowId ?? null,
  };
}

export async function commandBrowserScreenshot(options, deps = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = readTargetOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const rawFilePath = readOptionalString(options, "file") ?? DEFAULT_BROWSER_SCREENSHOT_PATH;
  const filePath = path.resolve(rawFilePath);
  const hideOverlay = shouldHideOverlay(options);
  const clientFactory = deps.clientFactory;
  const runWithBrowserAutoRecoveryFn = deps.runWithBrowserAutoRecoveryFn ?? runWithBrowserAutoRecovery;
  const writeFileFn = deps.writeFileFn ?? writeFile;
  const mkdirSyncFn = deps.mkdirSyncFn ?? mkdirSync;
  const stdout = deps.stdout ?? process.stdout;
  const client = createAutomationClient(clientFactory, {
    daemonUrl,
    targets,
    defaultTimeoutMs: timeoutMs,
  });

  try {
    const result = await captureScreenshotResult({
      client,
      daemonUrl,
      targets,
      timeoutMs,
      hideOverlay,
      runWithBrowserAutoRecoveryFn,
    });
    const screenshot = decodeScreenshotBase64(result);
    mkdirSyncFn(path.dirname(filePath), { recursive: true });
    await writeFileFn(filePath, Buffer.from(screenshot.base64, "base64"));
    stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          file: filePath,
          mimeType: screenshot.mimeType,
          capturedAt: screenshot.capturedAt,
          tabId: screenshot.tabId,
          windowId: screenshot.windowId,
          page: screenshot.page,
          hideOverlay,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}

export async function commandBrowserStudioSnapshot(options, deps = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = readTargetOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const hideOverlay = shouldHideOverlay(options);
  const rawFilePath = readOptionalString(options, "file");
  const filePath = rawFilePath ? path.resolve(rawFilePath) : null;
  const clientFactory = deps.clientFactory;
  const runWithBrowserAutoRecoveryFn = deps.runWithBrowserAutoRecoveryFn ?? runWithBrowserAutoRecovery;
  const writeFileFn = deps.writeFileFn ?? writeFile;
  const mkdirSyncFn = deps.mkdirSyncFn ?? mkdirSync;
  const stdout = deps.stdout ?? process.stdout;
  const client = createAutomationClient(clientFactory, {
    daemonUrl,
    targets,
    defaultTimeoutMs: timeoutMs,
  });

  try {
    const snapshot = await runWithBrowserAutoRecoveryFn({
      daemonUrl,
      targets,
      allowImageReadbackRetry: true,
      execute: async () => {
        const screenshotResult = await withOptionalOverlayHidden(client, hideOverlay, timeoutMs, () =>
          client.send(
            "page.screenshot",
            {
              ...targets,
            },
            {
              timeoutMs,
            },
          ));
        const domResult = await client.send(
          "page.content",
          {},
          {
            timeoutMs,
          },
        );
        const consoleResult = await client.send(
          "page.evaluate",
          serializeEvaluateInput(
            () => globalThis.KumaPickerExtensionRuntimeObserver?.readEntries?.() ?? { count: 0, entries: [] },
          ),
          {
            timeoutMs,
          },
        );

        return {
          screenshotResult,
          domResult,
          consoleResult,
        };
      },
    });

    const screenshot = decodeScreenshotBase64(snapshot?.screenshotResult);
    if (filePath) {
      mkdirSyncFn(path.dirname(filePath), { recursive: true });
      await writeFileFn(filePath, Buffer.from(screenshot.base64, "base64"));
    }

    stdout.write(
      `${JSON.stringify(
        {
          screenshot: screenshot.base64,
          dom:
            typeof snapshot?.domResult?.content === "string"
              ? snapshot.domResult.content
              : typeof snapshot?.domResult?.html === "string"
              ? snapshot.domResult.html
              : "",
          console: normalizeRuntimeConsoleEntries(snapshot?.consoleResult?.value),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}

export async function commandBrowserScreenshotDiff(options, deps = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = readTargetOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const hideOverlay = shouldHideOverlay(options);
  const beforePath = path.resolve(requireString(options, "before"));
  const diffFilePath = path.resolve(readOptionalString(options, "diff-file") ?? DEFAULT_BROWSER_SCREENSHOT_DIFF_PATH);
  const currentRawFilePath = readOptionalString(options, "file");
  const currentFilePath = currentRawFilePath ? path.resolve(currentRawFilePath) : null;
  const clientFactory = deps.clientFactory;
  const runWithBrowserAutoRecoveryFn = deps.runWithBrowserAutoRecoveryFn ?? runWithBrowserAutoRecovery;
  const writeFileFn = deps.writeFileFn ?? writeFile;
  const readFileFn = deps.readFileFn ?? readFile;
  const mkdirSyncFn = deps.mkdirSyncFn ?? mkdirSync;
  const stdout = deps.stdout ?? process.stdout;
  const client = createAutomationClient(clientFactory, {
    daemonUrl,
    targets,
    defaultTimeoutMs: timeoutMs,
  });

  try {
    const [beforeBuffer, screenshotResult] = await Promise.all([
      readFileFn(beforePath),
      captureScreenshotResult({
        client,
        daemonUrl,
        targets,
        timeoutMs,
        hideOverlay,
        runWithBrowserAutoRecoveryFn,
      }),
    ]);

    const screenshot = decodeScreenshotBase64(screenshotResult);
    const currentBuffer = Buffer.from(screenshot.base64, "base64");
    const beforeImage = decodePng(beforeBuffer);
    const currentImage = decodePng(currentBuffer);
    const diffImage = diffRgbaImages(beforeImage, currentImage);

    mkdirSyncFn(path.dirname(diffFilePath), { recursive: true });
    await writeFileFn(diffFilePath, encodePng(diffImage));

    if (currentFilePath) {
      mkdirSyncFn(path.dirname(currentFilePath), { recursive: true });
      await writeFileFn(currentFilePath, currentBuffer);
    }

    stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          before: beforePath,
          current: currentFilePath,
          diff: diffFilePath,
          width: diffImage.width,
          height: diffImage.height,
          changedPixels: diffImage.changedPixels,
          changedBounds: diffImage.changedBounds,
          hideOverlay,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}

export async function commandBrowserWaitFor(options, deps = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = readTargetOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const selector = requireString(options, "selector");
  const state = normalizeWaitState(readOptionalString(options, "state"));
  const clientFactory = deps.clientFactory;
  const runWithBrowserAutoRecoveryFn = deps.runWithBrowserAutoRecoveryFn ?? runWithBrowserAutoRecovery;
  const stdout = deps.stdout ?? process.stdout;
  const client = createAutomationClient(clientFactory, {
    daemonUrl,
    targets,
    defaultTimeoutMs: timeoutMs,
  });

  try {
    const result = await runWithBrowserAutoRecoveryFn({
      daemonUrl,
      targets,
      execute: () =>
        client.send(
          "page.waitForSelector",
          {
            selector,
            state,
          },
          {
            timeoutMs,
          },
        ),
    });

    stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          selector,
          state,
          timeoutMs,
          page: result?.page ?? null,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}

export async function commandBrowserType(options, deps = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = readTargetOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const delayMs = readNumber(options, "delay-ms", 0);
  const selector = requireString(options, "selector");
  const text = requireString(options, "text");
  const fill = options.fill === true;
  const locator = createSelectorLocator(selector);
  const clientFactory = deps.clientFactory;
  const runWithBrowserAutoRecoveryFn = deps.runWithBrowserAutoRecoveryFn ?? runWithBrowserAutoRecovery;
  const stdout = deps.stdout ?? process.stdout;
  const client = createAutomationClient(clientFactory, {
    daemonUrl,
    targets,
    defaultTimeoutMs: timeoutMs,
  });

  try {
    const result = await runWithBrowserAutoRecoveryFn({
      daemonUrl,
      targets,
      execute: async () => {
        if (fill) {
          return client.send(
            "locator.fill",
            {
              locator,
              value: text,
            },
            {
              timeoutMs,
            },
          );
        }

        await client.send(
          "locator.focus",
          {
            locator,
          },
          {
            timeoutMs,
          },
        );

        return client.send(
          "keyboard.type",
          {
            text,
            delay: Number.isFinite(delayMs) ? Math.max(0, Math.round(delayMs)) : 0,
          },
          {
            timeoutMs,
          },
        );
      },
    });

    stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: fill ? "fill" : "type",
          selector,
          text,
          timeoutMs,
          delayMs: fill ? null : (Number.isFinite(delayMs) ? Math.max(0, Math.round(delayMs)) : 0),
          page: result?.page ?? null,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}

export async function commandBrowserListTabs(options, deps = {}) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const readBrowserSessionWithAutoRecoveryFn =
    deps.readBrowserSessionWithAutoRecoveryFn ?? readBrowserSessionWithAutoRecovery;
  const stdout = deps.stdout ?? process.stdout;
  const session = await readBrowserSessionWithAutoRecoveryFn({
    daemonUrl,
    targets: {},
  });

  stdout.write(
    `${JSON.stringify(
      {
        connected: session?.connected === true,
        stale: session?.stale === true,
        tabCount: Array.isArray(session?.tabs) ? session.tabs.length : 0,
        tabs: formatSessionTabs(session),
      },
      null,
      2,
    )}\n`,
  );
}
