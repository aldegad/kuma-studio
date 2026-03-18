const { createSessionId } = AgentPickerExtensionShared;

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

function getExtensionManifestMetadata() {
  const manifest = chrome.runtime.getManifest();

  return {
    extensionId: chrome.runtime.id || null,
    extensionName: manifest?.name || "Agent Picker Bridge",
    extensionVersion: manifest?.version || "0.0.0",
    browserName: "chrome",
  };
}

async function reportExtensionHeartbeat(daemonUrl, details = {}) {
  const response = await fetch(`${daemonUrl}/extension-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...getExtensionManifestMetadata(),
      source: details.source || "unknown",
      page: details.page || null,
      browserTransport: typeof details.browserTransport === "string" ? details.browserTransport : undefined,
      socketConnected: typeof details.socketConnected === "boolean" ? details.socketConnected : undefined,
      lastSocketError:
        typeof details.lastSocketError === "string" || details.lastSocketError === null ? details.lastSocketError : undefined,
      lastSocketErrorAt:
        typeof details.lastSocketErrorAt === "string" || details.lastSocketErrorAt === null
          ? details.lastSocketErrorAt
          : undefined,
      lastSeenAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to report extension status to ${daemonUrl}.`);
  }

  return response.json();
}

async function reportBrowserSessionHeartbeat(daemonUrl, details = {}) {
  const response = await fetch(`${daemonUrl}/browser-session/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...getExtensionManifestMetadata(),
      source: details.source || "unknown",
      page: details.page || null,
      activeTabId: Number.isInteger(details.activeTabId) ? details.activeTabId : null,
      visible: details.visible === true,
      focused: details.focused === true,
      capabilities: [
        "context",
        "dom",
        "click",
        "click-point",
        "fill",
        "key",
        "refresh",
        "screenshot",
        "wait-for-download",
        "get-latest-download",
        "wait-for-text",
        "wait-for-text-disappear",
        "wait-for-selector",
        "wait-for-dialog-close",
        "query-dom",
      ],
      lastSeenAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to report browser session heartbeat to ${daemonUrl}.`);
  }

  return response.json();
}

async function claimNextBrowserCommand(daemonUrl, claimant = {}) {
  const endpoint = new URL(`${daemonUrl}/browser-session/commands/next`);
  if (Number.isInteger(claimant.tabId)) {
    endpoint.searchParams.set("tabId", String(claimant.tabId));
  }
  if (typeof claimant.url === "string" && claimant.url.trim()) {
    endpoint.searchParams.set("url", claimant.url.trim());
  }
  endpoint.searchParams.set("visible", claimant.visible === true ? "true" : "false");
  endpoint.searchParams.set("focused", claimant.focused === true ? "true" : "false");

  const response = await fetch(endpoint, {
    method: "GET",
    cache: "no-store",
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to read the next browser command from ${daemonUrl}.`);
  }

  return response.json();
}

async function reportBrowserCommandResult(daemonUrl, commandId, payload) {
  const response = await fetch(`${daemonUrl}/browser-session/commands/${commandId}/result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to report the browser command result for ${commandId}.`);
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

function createSnapshotPayload(screenshot, capturedAt) {
  if (!screenshot) {
    return null;
  }

  if (typeof screenshot === "string") {
    return {
      dataUrl: screenshot,
      mimeType: "image/png",
      width: 0,
      height: 0,
      capturedAt,
    };
  }

  return {
    dataUrl: screenshot.dataUrl,
    mimeType: screenshot.mimeType || "image/png",
    width: screenshot.width || 0,
    height: screenshot.height || 0,
    capturedAt: screenshot.capturedAt || capturedAt,
  };
}

function createSelectionPayload(pageContext, screenshot) {
  const capturedAt = new Date().toISOString();
  const snapshot = createSnapshotPayload(screenshot, capturedAt);
  const element = {
    ...pageContext.element,
    snapshot,
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

async function saveSelectionToDaemon(daemonUrl, pageContext, screenshot) {
  const response = await fetch(`${daemonUrl}/dev-selection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createSelectionPayload(pageContext, screenshot)),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to save the selection to ${daemonUrl}.`);
  }

  return response.json();
}
