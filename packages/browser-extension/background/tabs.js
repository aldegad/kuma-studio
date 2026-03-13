async function queryActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.windowId || !tab.url) {
    throw new Error("No active browser tab is available.");
  }

  return tab;
}

async function resolveTargetTab(message) {
  if (typeof message?.tabId === "number") {
    const tab = await chrome.tabs.get(message.tabId);
    if (tab?.id && tab.windowId && tab.url) {
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

async function enableInspectBadge(tabId) {
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#0f8a6d",
  });
  await chrome.action.setBadgeText({ tabId, text: "ON" });
}
