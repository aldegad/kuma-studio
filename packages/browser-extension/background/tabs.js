async function queryActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.windowId || !tab.url) {
    throw new Error("No active browser tab is available.");
  }

  return tab;
}

function isResolvableTab(tab) {
  return Boolean(tab?.id && tab?.windowId && typeof tab?.url === "string" && tab.url);
}

function rankResolvedTabs(left, right) {
  return (
    Number(right.active === true) - Number(left.active === true) ||
    Number(right.highlighted === true) - Number(left.highlighted === true) ||
    Number((right.lastAccessed ?? 0) > (left.lastAccessed ?? 0)) -
      Number((right.lastAccessed ?? 0) < (left.lastAccessed ?? 0)) ||
    Number(right.id ?? 0) - Number(left.id ?? 0)
  );
}

async function queryMatchingTabs(predicate) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => isResolvableTab(tab) && predicate(tab)).sort(rankResolvedTabs);
}

async function resolveTargetTab(message) {
  if (typeof message?.tabId === "number") {
    const tab = await chrome.tabs.get(message.tabId);
    if (tab?.id && tab.windowId && tab.url) {
      return tab;
    }
  }

  const targetUrl =
    typeof message?.url === "string"
      ? message.url.trim()
      : typeof message?.targetUrl === "string"
        ? message.targetUrl.trim()
        : "";
  if (targetUrl) {
    const matchingTabs = await queryMatchingTabs((tab) => tab.url === targetUrl);
    if (matchingTabs[0]) {
      return matchingTabs[0];
    }

    throw new Error(`No browser tab matches the requested URL: ${targetUrl}`);
  }

  const targetUrlContains =
    typeof message?.urlContains === "string"
      ? message.urlContains.trim()
      : typeof message?.targetUrlContains === "string"
        ? message.targetUrlContains.trim()
        : "";
  if (targetUrlContains) {
    const matchingTabs = await queryMatchingTabs((tab) => tab.url.includes(targetUrlContains));
    if (matchingTabs[0]) {
      return matchingTabs[0];
    }

    throw new Error(`No browser tab matches the requested URL fragment: ${targetUrlContains}`);
  }

  return queryActiveTab();
}

async function sendMessageToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    throw new Error("This page does not accept the Agent Picker content script. Try a regular website tab instead of a browser-internal page.");
  }
}

async function captureTabScreenshot(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

async function waitForTabReloadComplete(tabId, timeoutMs = 15_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      rejectPromise(new Error(`Timed out waiting for tab ${tabId} to finish reloading.`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    }

    async function handleUpdated(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      cleanup();
      resolvePromise(updatedTab?.id ? updatedTab : await chrome.tabs.get(tabId));
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
}

async function reloadTargetTab(tab, { bypassCache = false, timeoutMs = 15_000 } = {}) {
  if (!isResolvableTab(tab)) {
    throw new Error("Failed to resolve the target browser tab before reloading.");
  }

  const reloadWait = waitForTabReloadComplete(tab.id, timeoutMs);
  await chrome.tabs.reload(tab.id, { bypassCache });
  const reloadedTab = await reloadWait;

  return {
    tab: reloadedTab,
    bypassCache,
  };
}

function waitForDelay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function focusTargetTab(tab) {
  if (!isResolvableTab(tab)) {
    throw new Error("Failed to focus the target browser tab before taking a screenshot.");
  }

  await chrome.windows.update(tab.windowId, { focused: true });
  const activatedTab = await chrome.tabs.update(tab.id, { active: true });
  return activatedTab?.id ? activatedTab : chrome.tabs.get(tab.id);
}

async function waitForFocusedTargetTab(tab, attempts = 5, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [targetWindow, refreshedTab] = await Promise.all([
      chrome.windows.get(tab.windowId),
      chrome.tabs.get(tab.id),
    ]);

    if (targetWindow.focused === true && refreshedTab.active === true) {
      return {
        tab: refreshedTab,
        window: targetWindow,
      };
    }

    if (attempt < attempts - 1) {
      await waitForDelay(delayMs);
    }
  }

  return {
    tab: await chrome.tabs.get(tab.id),
    window: await chrome.windows.get(tab.windowId),
  };
}

async function captureTargetTabScreenshot(tab, { focusTabFirst = true } = {}) {
  const targetTab = focusTabFirst ? await focusTargetTab(tab) : tab;
  const focusedTarget = await waitForFocusedTargetTab(targetTab);
  const confirmedTab = focusedTarget.tab;
  const targetWindow = focusedTarget.window;

  if (confirmedTab.active !== true) {
    throw new Error("Failed to activate the target tab before taking a screenshot.");
  }

  return {
    dataUrl: await captureTabScreenshot(confirmedTab.windowId),
    tabId: confirmedTab.id,
    windowId: confirmedTab.windowId,
    focused: targetWindow.focused === true,
    active: confirmedTab.active === true,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeViewportRect(rect) {
  const candidate = rect && typeof rect === "object" ? rect : {};

  return {
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0,
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
  };
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function cropTabScreenshot(screenshotDataUrl, rect, viewport) {
  const normalizedRect = normalizeViewportRect(rect);
  const viewportWidth = Number(viewport?.width) || 0;
  const viewportHeight = Number(viewport?.height) || 0;

  if (normalizedRect.width < 1 || normalizedRect.height < 1) {
    throw new Error("The dragged area is too small to capture.");
  }

  if (viewportWidth < 1 || viewportHeight < 1) {
    throw new Error("Missing viewport metrics for the dragged capture.");
  }

  const response = await fetch(screenshotDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  try {
    const scaleX = bitmap.width / viewportWidth;
    const scaleY = bitmap.height / viewportHeight;
    const sourceX = clamp(Math.round(normalizedRect.x * scaleX), 0, Math.max(0, bitmap.width - 1));
    const sourceY = clamp(Math.round(normalizedRect.y * scaleY), 0, Math.max(0, bitmap.height - 1));
    const sourceWidth = clamp(
      Math.round(normalizedRect.width * scaleX),
      1,
      Math.max(1, bitmap.width - sourceX),
    );
    const sourceHeight = clamp(
      Math.round(normalizedRect.height * scaleY),
      1,
      Math.max(1, bitmap.height - sourceY),
    );
    const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to create a canvas for dragged capture.");
    }

    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

    const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
    const croppedBytes = new Uint8Array(await croppedBlob.arrayBuffer());

    return {
      dataUrl: `data:image/png;base64,${base64FromBytes(croppedBytes)}`,
      mimeType: "image/png",
      width: sourceWidth,
      height: sourceHeight,
    };
  } finally {
    bitmap.close();
  }
}

async function enableInspectBadge(tabId) {
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#0f8a6d",
  });
  await chrome.action.setBadgeText({ tabId, text: "ON" });
}
