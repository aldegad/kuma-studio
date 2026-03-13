const DEFAULT_DAEMON_URL = "http://127.0.0.1:4312";
const STORAGE_KEY = "agentPicker.browserExtension.daemonUrl";
const INSPECT_KEY_PREFIX = "agentPicker.browserExtension.inspect.";

function normalizeDaemonUrl(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  return (trimmed || DEFAULT_DAEMON_URL).replace(/\/+$/, "");
}

function createSessionId() {
  if (typeof crypto?.randomUUID === "function") {
    return `browser-${crypto.randomUUID()}`;
  }

  return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getStoredDaemonUrl() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeDaemonUrl(stored[STORAGE_KEY]);
}

async function setStoredDaemonUrl(rawValue) {
  const daemonUrl = normalizeDaemonUrl(rawValue);
  await chrome.storage.local.set({ [STORAGE_KEY]: daemonUrl });
  return daemonUrl;
}

async function queryActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const [tab] = tabs;

  if (!tab?.id || !tab.windowId || !tab.url) {
    throw new Error("No active browser tab is available.");
  }

  return tab;
}

async function resolveTargetTab(message) {
  if (typeof message?.tabId === "number") {
    const tab = await chrome.tabs.get(message.tabId);
    if (tab?.id && tab.windowId) {
      return tab;
    }
  }

  return queryActiveTab();
}

async function sendMessageToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    throw new Error(
      "This page does not accept the Agent Picker content script. Try a regular website tab instead of a browser-internal page.",
    );
  }
}

async function captureTabScreenshot(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

async function fetchDaemonHealth(daemonUrl) {
  const response = await fetch(`${daemonUrl}/health`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Bridge health check failed with status ${response.status}.`);
  }

  return response.json();
}

function getSessionLabel(page) {
  try {
    const hostname = new URL(page.url).hostname;
    return page.title?.trim() ? `${hostname} - ${page.title.trim()}` : hostname;
  } catch {
    return page.title?.trim() || "Browser Extension";
  }
}

function createSelectionPayload(pageContext, screenshotDataUrl) {
  const capturedAt = new Date().toISOString();
  const element = {
    ...pageContext.element,
    snapshot: screenshotDataUrl
      ? {
          dataUrl: screenshotDataUrl,
          mimeType: "image/png",
          width: 0,
          height: 0,
          capturedAt,
        }
      : null,
  };

  return {
    version: 1,
    capturedAt,
    page: pageContext.page,
    session: {
      id: createSessionId(),
      label: getSessionLabel(pageContext.page),
      index: 0,
      updatedAt: capturedAt,
    },
    element,
    elements: [element],
  };
}

async function saveSelectionToDaemon(daemonUrl, pageContext, screenshotDataUrl) {
  const response = await fetch(`${daemonUrl}/dev-selection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createSelectionPayload(pageContext, screenshotDataUrl)),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      responseText || `Failed to save the selection to ${daemonUrl}.`,
    );
  }

  return response.json();
}

async function setInspectState(tabId, daemonUrl) {
  await chrome.storage.local.set({
    [`${INSPECT_KEY_PREFIX}${tabId}`]: {
      daemonUrl,
      armedAt: new Date().toISOString(),
    },
  });
}

async function getInspectState(tabId) {
  const key = `${INSPECT_KEY_PREFIX}${tabId}`;
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? null;
}

async function clearInspectState(tabId) {
  await chrome.storage.local.remove(`${INSPECT_KEY_PREFIX}${tabId}`);
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch {
    // Ignore badge cleanup errors after the tab has already gone away.
  }
}

async function handleCapturePage(daemonUrl, message) {
  const tab = await resolveTargetTab(message);
  const pageContextResponse = await sendMessageToTab(tab.id, {
    type: "agent-picker:collect-page",
  });

  if (!pageContextResponse?.ok || !pageContextResponse.pageContext) {
    throw new Error(pageContextResponse?.error || "Failed to read the page.");
  }

  const screenshotDataUrl = await captureTabScreenshot(tab.windowId);
  const selection = await saveSelectionToDaemon(
    daemonUrl,
    pageContextResponse.pageContext,
    screenshotDataUrl,
  );

  return {
    ok: true,
    message: "Current page saved to the bridge.",
    selection,
  };
}

async function handleStartInspect(daemonUrl, message) {
  const tab = await resolveTargetTab(message);

  await setInspectState(tab.id, daemonUrl);
  await chrome.action.setBadgeBackgroundColor({
    tabId: tab.id,
    color: "#0f8a6d",
  });
  await chrome.action.setBadgeText({ tabId: tab.id, text: "ON" });

  const response = await sendMessageToTab(tab.id, {
    type: "agent-picker:start-inspect",
  });
  if (!response?.ok) {
    await clearInspectState(tab.id);
    throw new Error(response?.error || "Failed to arm inspect mode.");
  }

  return {
    ok: true,
    message: "Inspect mode armed. Click the target element in the page.",
  };
}

async function handleInspectPicked(message, sender) {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (!tabId || !windowId) {
    throw new Error("Missing browser tab information for the picked element.");
  }

  const inspectState = await getInspectState(tabId);
  if (!inspectState?.daemonUrl) {
    throw new Error("Inspect mode is no longer active for this tab.");
  }

  const screenshotDataUrl = await captureTabScreenshot(windowId);
  const selection = await saveSelectionToDaemon(
    inspectState.daemonUrl,
    message.pageContext,
    screenshotDataUrl,
  );

  await clearInspectState(tabId);
  await sendMessageToTab(tabId, {
    type: "agent-picker:inspect-result",
    ok: true,
    message: "Element saved to the local Agent Picker bridge.",
  });

  return {
    ok: true,
    message: "Element saved to the bridge.",
    selection,
  };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearInspectState(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      const incomingDaemonUrl =
        typeof message?.daemonUrl === "string" ? message.daemonUrl : null;
      const daemonUrl = incomingDaemonUrl
        ? await setStoredDaemonUrl(incomingDaemonUrl)
        : await getStoredDaemonUrl();

      switch (message?.type) {
        case "agent-picker:test-daemon": {
          await fetchDaemonHealth(daemonUrl);
          sendResponse({
            ok: true,
            message: `Bridge reachable at ${daemonUrl}.`,
          });
          return;
        }
        case "agent-picker:capture-page": {
          sendResponse(await handleCapturePage(daemonUrl, message));
          return;
        }
        case "agent-picker:start-inspect": {
          sendResponse(await handleStartInspect(daemonUrl, message));
          return;
        }
        case "agent-picker:inspect-picked": {
          sendResponse(await handleInspectPicked(message, sender));
          return;
        }
        case "agent-picker:cancel-inspect": {
          if (sender.tab?.id) {
            await clearInspectState(sender.tab.id);
          }
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({
            ok: false,
            error: `Unknown message type: ${String(message?.type)}`,
          });
      }
    } catch (error) {
      if (sender.tab?.id && message?.type === "agent-picker:inspect-picked") {
        await clearInspectState(sender.tab.id);
        try {
          await sendMessageToTab(sender.tab.id, {
            type: "agent-picker:inspect-result",
            ok: false,
            message:
              error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Ignore follow-up notification failures after an inspect error.
        }
      }

      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});
