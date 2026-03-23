const CONTENT_SCRIPT_UNAVAILABLE_ERROR =
  "This page does not accept the Kuma Picker content script. Try a regular website tab instead of a browser-internal page.";
const COMMAND_TOOLS_NOT_READY_ERROR = "The Kuma Picker browser command tools are not loaded for this page yet.";

function isTransientContentScriptError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message === CONTENT_SCRIPT_UNAVAILABLE_ERROR || message === COMMAND_TOOLS_NOT_READY_ERROR;
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

async function sendAgentCommandToTab(tabId, command) {
  let response = null;
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      response = await sendMessageToTab(tabId, {
        type: "kuma-picker:browser-command",
        command,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientContentScriptError(error)) {
        break;
      }

      await ensureBrowserCommandBridge(tabId);
      await waitForDelay(150);
      continue;
    }

    if (response?.ok) {
      return response.result ?? null;
    }

    if (response?.error !== COMMAND_TOOLS_NOT_READY_ERROR) {
      break;
    }

    await ensureBrowserCommandBridge(tabId);
    await waitForDelay(150);
  }

  if (!response?.ok) {
    throw lastError instanceof Error
      ? lastError
      : new Error(response?.error || "The active tab rejected the browser command.");
  }

  return response.result ?? null;
}

async function collectPageContextWithRetry(tabId, attempts = 8, delayMs = 150) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await collectPageContext(tabId);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1 && isTransientContentScriptError(error)) {
        await ensureBrowserCommandBridge(tabId);
        await waitForDelay(delayMs);
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to read the page after reloading.");
}

function normalizeScreenshotClipRect(command) {
  const candidate = command?.clipRect;
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

function getScreenshotSelector(command) {
  if (typeof command?.selectorPath === "string") {
    return command.selectorPath;
  }

  return typeof command?.selector === "string" ? command.selector : null;
}

function getRefreshTimeoutMs(command) {
  return typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) && command.timeoutMs > 0
    ? command.timeoutMs
    : 15_000;
}

async function executeScreenshotBrowserCommand(tab, command) {
  const pageContext = await collectPageContext(tab.id);
  const capture = await captureTargetTabScreenshot(tab, {
    focusTabFirst: command?.focusTabFirst !== false,
    restorePreviousActiveTab: command?.restorePreviousActiveTab === true,
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
  let clip = null;

  const selector = getScreenshotSelector(command);
  const clipRect = normalizeScreenshotClipRect(command);

  if (selector || clipRect) {
    const measured = selector
      ? await sendAgentCommandToTab(tab.id, {
          type: "measure",
          selector: typeof command?.selector === "string" ? command.selector : null,
          selectorPath: typeof command?.selectorPath === "string" ? command.selectorPath : null,
          scope: typeof command?.scope === "string" ? command.scope : null,
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
    clip = {
      mode: measured ? "selector" : "rect",
      scope: typeof command?.scope === "string" ? command.scope : "page",
      selector: measured?.selector ?? null,
      rect,
      element: measured?.element ?? null,
    };
  }

  return {
    page: pageContext.page,
    screenshot,
    capture: {
      tabId: capture.tabId,
      windowId: capture.windowId,
      focused: capture.focused,
      active: capture.active,
    },
    clip,
  };
}

async function executeRefreshBrowserCommand(tab, command) {
  const reloaded = await reloadTargetTab(tab, {
    bypassCache: command?.bypassCache === true,
    timeoutMs: getRefreshTimeoutMs(command),
  });
  const pageContext = await collectPageContextWithRetry(reloaded.tab.id);

  return {
    page: pageContext.page,
    refreshedTabId: reloaded.tab.id,
    refreshedWindowId: reloaded.tab.windowId ?? null,
    bypassCache: reloaded.bypassCache,
    status: reloaded.tab.status ?? null,
  };
}

async function executeNavigateBrowserCommand(tab, command) {
  const navigationUrl = typeof command?.navigationUrl === "string" ? command.navigationUrl.trim() : "";
  if (!navigationUrl) {
    throw new Error("The navigate command requires a non-empty destination URL.");
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(navigationUrl);
  } catch {
    throw new Error(`Invalid navigation URL: ${navigationUrl}`);
  }

  const timeoutMs = getRefreshTimeoutMs(command);
  const navigationResult = command?.newTab === true
    ? await createTargetTab({
        url: parsedUrl.toString(),
        windowId: tab?.windowId,
        index: Number.isInteger(tab?.index) ? tab.index + 1 : undefined,
        active: command?.active !== false,
        timeoutMs,
      })
    : await navigateTargetTab(tab, {
        url: parsedUrl.toString(),
        timeoutMs,
      });

  let pageContext = null;
  try {
    pageContext = await collectPageContextWithRetry(navigationResult.tab.id);
  } catch {
    pageContext = null;
  }

  return {
    page: pageContext?.page ?? createPageRecordFromTab(navigationResult.tab),
    navigatedTabId: navigationResult.tab.id,
    navigatedWindowId: navigationResult.tab.windowId ?? null,
    requestedUrl: parsedUrl.toString(),
    newTab: command?.newTab === true,
    active: navigationResult.tab.active === true,
    status: navigationResult.tab.status ?? null,
    contentScriptReady: pageContext != null,
  };
}

async function executeWaitForDownloadBrowserCommand(tab, command) {
  const pageContext = await collectPageContext(tab.id);
  const { filter, waitedMs, record, permission } = await waitForMatchingDownload(command, tab);
  return {
    page: pageContext.page,
    matched: true,
    waitedMs,
    download: serializeDownloadResult(record, filter),
    permission: serializeDownloadPermission(permission),
  };
}

async function executeGetLatestDownloadBrowserCommand(tab, command) {
  const pageContext = await collectPageContext(tab.id);
  const { filter, record, permission } = await getLatestDownload(command, tab);
  return {
    page: pageContext.page,
    download: serializeDownloadResult(record, filter),
    permission: serializeDownloadPermission(permission),
  };
}

async function executeDownloadPermissionBrowserCommand(tab) {
  const pageContext = await collectPageContext(tab.id);
  const permission = await getDownloadPermission(tab);
  return {
    page: pageContext.page,
    permission: serializeDownloadPermission(permission),
  };
}

async function executeEvalBrowserCommand(tab, command) {
  return evaluateDebuggerExpression(tab, command);
}

async function executeBrowserCommand(tab, command) {
  switch (command?.type) {
    case "context":
      return {
        pageContext: await collectPageContext(tab.id),
      };
    case "debugger-capture":
      return captureDebuggerDiagnostics(tab, command);
    case "navigate":
      return executeNavigateBrowserCommand(tab, command);
    case "eval":
      return executeEvalBrowserCommand(tab, command);
    case "set-files":
      return setFileInputFiles(tab, command);
    case "dom":
    case "click":
    case "sequence":
    case "click-point":
    case "pointer-drag":
    case "fill":
    case "key":
    case "keydown":
    case "keyup":
    case "mousemove":
    case "mousedown":
    case "mouseup":
    case "console":
    case "wait-for-text":
    case "wait-for-text-disappear":
    case "wait-for-selector":
    case "wait-for-dialog-close":
    case "query-dom":
      return sendAgentCommandToTab(tab.id, command);
    case "screenshot":
      return executeScreenshotBrowserCommand(tab, command);
    case "refresh":
      return executeRefreshBrowserCommand(tab, command);
    case "wait-for-download":
      return executeWaitForDownloadBrowserCommand(tab, command);
    case "get-latest-download":
      return executeGetLatestDownloadBrowserCommand(tab, command);
    case "download-permission":
      return executeDownloadPermissionBrowserCommand(tab);
    default:
      throw new Error(`Unsupported Kuma Picker browser command: ${String(command?.type)}`);
  }
}
