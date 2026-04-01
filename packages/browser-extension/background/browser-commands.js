const CONTENT_SCRIPT_UNAVAILABLE_ERROR =
  "This page does not accept the Kuma Picker automation runtime. Try a regular website tab instead of a browser-internal page.";
const AUTOMATION_RUNTIME_NOT_READY_ERROR = "The Kuma Picker automation runtime is not loaded for this page yet.";
const AUTOMATION_RETRY_DELAYS_MS = [30, 50, 80, 120, 160, 220, 300];

function isTransientAutomationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message === CONTENT_SCRIPT_UNAVAILABLE_ERROR || message === AUTOMATION_RUNTIME_NOT_READY_ERROR;
}

function getAutomationRetryDelayMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0) {
    return AUTOMATION_RETRY_DELAYS_MS[0];
  }

  return AUTOMATION_RETRY_DELAYS_MS[Math.min(attempt, AUTOMATION_RETRY_DELAYS_MS.length - 1)];
}

async function collectPageContext(tabId) {
  const response = await sendMessageToTab(tabId, {
    type: "kuma-picker:collect-page",
  });

  if (!response?.ok || !response.pageContext) {
    throw new Error(response?.error || "Failed to read the page.");
  }

  return response.pageContext;
}

function buildPageRecordFromTab(tab) {
  const url = typeof tab?.url === "string" ? tab.url : null;
  let pathname = null;

  if (url) {
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = null;
    }
  }

  return {
    url,
    pathname,
    title: typeof tab?.title === "string" ? tab.title : null,
  };
}

async function sendAutomationCommandToTab(tabId, command) {
  let response = null;
  let lastError = null;

  await ensureAutomationBridge(tabId);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      response = await sendMessageToTab(tabId, {
        type: "kuma-picker:automation-command",
        command,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientAutomationError(error)) {
        break;
      }

      invalidateAutomationBridge(tabId);
      await ensureAutomationBridge(tabId);
      await waitForDelay(getAutomationRetryDelayMs(attempt));
      continue;
    }

    if (response?.ok) {
      return response.result ?? null;
    }

    if (response?.error !== AUTOMATION_RUNTIME_NOT_READY_ERROR) {
      break;
    }

    invalidateAutomationBridge(tabId);
    await ensureAutomationBridge(tabId);
    await waitForDelay(getAutomationRetryDelayMs(attempt));
  }

  if (!response?.ok) {
    throw lastError instanceof Error
      ? lastError
      : new Error(response?.error || "The active tab rejected the automation request.");
  }

  return response.result ?? null;
}

function normalizeScreenshotClipRect(command) {
  const candidate = command?.clip;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const rect = {
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0,
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
  };

  return rect.width >= 1 && rect.height >= 1 ? rect : null;
}

function getRefreshTimeoutMs(command) {
  return typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) && command.timeoutMs > 0
    ? command.timeoutMs
    : 15_000;
}

async function executePageEvaluateCommand(tab, command) {
  try {
    return await executeDebuggerEvaluateCommand(tab, command);
  } catch (error) {
    if (!shouldFallbackDebuggerEvaluate(error)) {
      throw error;
    }

    const fallbackResult = await sendAutomationCommandToTab(tab.id, command);
    return {
      ...fallbackResult,
      executionWorld: fallbackResult?.executionWorld ?? "content-script",
      evaluateBackend: fallbackResult?.evaluateBackend ?? "content-script",
      fallbackUsed: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
      fallbackFrom: "debugger",
    };
  }
}

async function executePageScreenshotCommand(tab, command) {
  const fullPage = command?.fullPage === true;
  const pageContext = await collectPageContext(tab.id);
  const viewport = pageContext?.viewport ?? {};
  const viewportWidth = Number(viewport.width) || 0;
  const viewportHeight = Number(viewport.height) || 0;
  const devicePixelRatio = Number(viewport.devicePixelRatio) || 1;
  const scrollX = Number(viewport.scrollX) || 0;
  const scrollY = Number(viewport.scrollY) || 0;
  const scrollWidth = Number(viewport.scrollWidth) || viewportWidth;
  const scrollHeight = Number(viewport.scrollHeight) || viewportHeight;

  const selector = typeof command?.selector === "string" ? command.selector : null;
  const clipRect = normalizeScreenshotClipRect(command);

  if (fullPage && !selector && !clipRect) {
    // Capture the full page by scrolling through it and stitching strips together.
    const fullWidth = Math.max(viewportWidth, scrollWidth);
    const fullHeight = Math.max(viewportHeight, scrollHeight);
    const stitched = await captureFullPageScreenshot(tab, tab.id, {
      viewportWidth,
      viewportHeight,
      fullWidth,
      fullHeight,
      devicePixelRatio,
      scrollX,
      scrollY,
    });
    return {
      page: pageContext.page,
      screenshot: {
        dataUrl: stitched.dataUrl,
        mimeType: "image/png",
        width: stitched.width,
        height: stitched.height,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  const capture = await captureTargetTabScreenshot(tab, {
    focusTabFirst: true,
    restorePreviousActiveTab: false,
  });

  let screenshot = {
    dataUrl: capture.dataUrl,
    mimeType: "image/png",
    width: Math.max(0, Math.round(viewportWidth * devicePixelRatio)),
    height: Math.max(0, Math.round(viewportHeight * devicePixelRatio)),
    capturedAt: new Date().toISOString(),
  };

  if (selector || clipRect) {
    const measured = selector
      ? await sendAutomationCommandToTab(tab.id, {
          type: "playwright",
          action: "locator.measure",
          locator: {
            kind: "selector",
            selector,
          },
        })
      : null;
    // clip rect from locator.measure uses getBoundingClientRect() which is already
    // viewport-relative, so no scroll offset adjustment is needed here.
    const rect = clipRect ?? measured?.rect ?? null;
    const cropped = await cropTabScreenshot(capture.dataUrl, rect, viewport);
    screenshot = {
      dataUrl: cropped.dataUrl,
      mimeType: cropped.mimeType,
      width: cropped.width,
      height: cropped.height,
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    page: pageContext.page,
    screenshot,
  };
}

async function captureFullPageScreenshot(tab, tabId, { viewportWidth, viewportHeight, fullWidth, fullHeight, devicePixelRatio, scrollX, scrollY }) {
  const strips = [];
  let captureY = 0;

  // Scroll through the page top-to-bottom, capturing viewport-sized strips.
  // Use the debugger path so window.scrollTo runs in the real page (main world),
  // not the isolated content-script world where scrollTo has no effect.
  while (captureY < fullHeight) {
    await executeDebuggerEvaluateCommand(tab, {
      kind: "function",
      source: `function(arg) { window.scrollTo(arg.x, arg.y); }`,
      arg: { x: 0, y: captureY },
    });

    // Small settle delay so the browser composites the new scroll position.
    await waitForDelay(60);

    const capture = await captureTargetTabScreenshot(tab, {
      focusTabFirst: true,
      restorePreviousActiveTab: false,
      paintSettleDelayMs: 0,
    });

    strips.push({ dataUrl: capture.dataUrl, offsetY: captureY });
    captureY += viewportHeight;
  }

  // Restore original scroll position.
  await executeDebuggerEvaluateCommand(tab, {
    kind: "function",
    source: `function(arg) { window.scrollTo(arg.x, arg.y); }`,
    arg: { x: scrollX, y: scrollY },
  }).catch(() => null);

  // Stitch strips into a single full-page image using OffscreenCanvas.
  const physicalWidth = Math.round(fullWidth * devicePixelRatio);
  const physicalHeight = Math.round(fullHeight * devicePixelRatio);
  const physicalViewportHeight = Math.round(viewportHeight * devicePixelRatio);
  const canvas = new OffscreenCanvas(physicalWidth, physicalHeight);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to create canvas context for full-page screenshot.");
  }

  for (const strip of strips) {
    const response = await fetch(strip.dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const destY = Math.round(strip.offsetY * devicePixelRatio);
      const sourceHeight = Math.min(physicalViewportHeight, physicalHeight - destY);
      ctx.drawImage(bitmap, 0, 0, bitmap.width, sourceHeight, 0, destY, physicalWidth, sourceHeight);
    } finally {
      bitmap.close();
    }
  }

  const resultBlob = await canvas.convertToBlob({ type: "image/png" });
  const resultBytes = new Uint8Array(await resultBlob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < resultBytes.length; i += chunkSize) {
    binary += String.fromCharCode(...resultBytes.subarray(i, i + chunkSize));
  }

  return {
    dataUrl: `data:image/png;base64,${btoa(binary)}`,
    width: physicalWidth,
    height: physicalHeight,
  };
}

async function executePageReloadCommand(tab, command) {
  const reloaded = await reloadTargetTab(tab, {
    bypassCache: command?.bypassCache === true,
    timeoutMs: getRefreshTimeoutMs(command),
  });

  return {
    page: buildPageRecordFromTab(reloaded.tab),
    bypassCache: reloaded.bypassCache,
    status: reloaded.tab.status ?? null,
  };
}

async function executePageGotoCommand(tab, command) {
  const navigationUrl = typeof command?.url === "string" ? command.url.trim() : "";
  if (!navigationUrl) {
    throw new Error("page.goto requires a non-empty URL.");
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(navigationUrl);
  } catch {
    throw new Error(`Invalid navigation URL: ${navigationUrl}`);
  }

  const navigationResult = await navigateTargetTab(tab, {
    url: parsedUrl.toString(),
    timeoutMs: getRefreshTimeoutMs(command),
  });

  return {
    page: buildPageRecordFromTab(navigationResult.tab),
    status: navigationResult.tab.status ?? null,
  };
}

async function executePlaywrightCommand(tab, command) {
  switch (command?.action) {
    case "page.goto":
      return executePageGotoCommand(tab, command);
    case "page.reload":
      return executePageReloadCommand(tab, command);
    case "page.evaluate":
      return executePageEvaluateCommand(tab, command);
    case "page.screenshot":
      return executePageScreenshotCommand(tab, command);
    default:
      return sendAutomationCommandToTab(tab.id, command);
  }
}

async function executeBrowserCommand(tab, command) {
  if (command?.type !== "playwright") {
    throw new Error(`Unsupported Kuma Picker automation command: ${String(command?.type)}`);
  }

  return executePlaywrightCommand(tab, command);
}
