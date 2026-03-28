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

async function collectPageContextWithRetry(tabId, attempts = 8, delayMs = null) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await collectPageContext(tabId);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1 && isTransientAutomationError(error)) {
        invalidateAutomationBridge(tabId);
        await ensureAutomationBridge(tabId);
        await waitForDelay(
          typeof delayMs === "number" && Number.isFinite(delayMs) ? delayMs : getAutomationRetryDelayMs(attempt),
        );
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to read the page after reloading.");
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

async function executePageScreenshotCommand(tab, command) {
  const pageContext = await collectPageContext(tab.id);
  const capture = await captureTargetTabScreenshot(tab, {
    focusTabFirst: true,
    restorePreviousActiveTab: false,
  });
  const viewportWidth = Number(pageContext?.viewport?.width) || 0;
  const viewportHeight = Number(pageContext?.viewport?.height) || 0;
  const devicePixelRatio = Number(pageContext?.viewport?.devicePixelRatio) || 1;
  let screenshot = {
    dataUrl: capture.dataUrl,
    mimeType: "image/png",
    width: Math.max(0, Math.round(viewportWidth * devicePixelRatio)),
    height: Math.max(0, Math.round(viewportHeight * devicePixelRatio)),
    capturedAt: new Date().toISOString(),
  };

  const selector = typeof command?.selector === "string" ? command.selector : null;
  const clipRect = normalizeScreenshotClipRect(command);

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
    const rect = clipRect ?? measured?.rect ?? null;
    const cropped = await cropTabScreenshot(capture.dataUrl, rect, pageContext.viewport);
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
