let isPollingBrowserCommands = false;
const knownBrowserTabs = new Map();

async function collectPageContext(tabId) {
  const response = await sendMessageToTab(tabId, {
    type: "agent-picker:collect-page",
  });

  if (!response?.ok || !response.pageContext) {
    throw new Error(response?.error || "Failed to read the page.");
  }

  return response.pageContext;
}

async function sendAgentCommandToTab(tabId, command) {
  const response = await sendMessageToTab(tabId, {
    type: "agent-picker:browser-command",
    command,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "The active tab rejected the browser command.");
  }

  return response.result ?? null;
}

async function reportExtensionHeartbeatSafely(daemonUrl, payload) {
  try {
    await reportExtensionHeartbeat(daemonUrl, payload);
  } catch {
    // Do not block the main capture flow on best-effort presence reporting.
  }
}

async function reportBrowserSessionHeartbeatSafely(daemonUrl, payload) {
  try {
    await reportBrowserSessionHeartbeat(daemonUrl, payload);
  } catch {
    // Do not block command polling on best-effort session heartbeats.
  }
}

function upsertKnownBrowserTab(sender, message) {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  const page = message?.page ?? createPageRecordFromTab(sender.tab);

  if (!tabId || !windowId || !page?.url) {
    return null;
  }

  const claimant = {
    tabId,
    windowId,
    url: page.url,
    visible: message?.visibilityState === "visible",
    focused: message?.hasFocus === true,
    lastSeenAt: new Date().toISOString(),
  };

  knownBrowserTabs.set(tabId, claimant);
  return claimant;
}

function listKnownBrowserTabs(primaryClaimant = null) {
  const ordered = [...knownBrowserTabs.values()].sort((left, right) => {
    return (
      Number(right.focused === true) - Number(left.focused === true) ||
      Number(right.visible === true) - Number(left.visible === true) ||
      Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0) ||
      right.tabId - left.tabId
    );
  });

  if (!primaryClaimant) {
    return ordered;
  }

  return [
    primaryClaimant,
    ...ordered.filter((entry) => entry.tabId !== primaryClaimant.tabId),
  ];
}

async function executeClaimedBrowserCommand(daemonUrl, claimant, command) {
  try {
    const tab = await chrome.tabs.get(claimant.tabId);
    const result = await executeBrowserCommand(tab, command);
    await reportBrowserCommandResult(daemonUrl, command.id, {
      ok: true,
      result,
    });
  } catch (error) {
    knownBrowserTabs.delete(claimant.tabId);
    await reportBrowserCommandResult(daemonUrl, command.id, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function pollQueuedBrowserCommands(daemonUrl, primaryClaimant = null) {
  if (isPollingBrowserCommands) {
    return false;
  }

  isPollingBrowserCommands = true;

  try {
    let polledCommand = false;

    for (let attempts = 0; attempts < 25; attempts += 1) {
      const claimants = listKnownBrowserTabs(primaryClaimant);
      let matchedCommand = false;

      for (const claimant of claimants) {
        const command = await claimNextBrowserCommand(daemonUrl, claimant);
        if (!command) {
          continue;
        }

        matchedCommand = true;
        polledCommand = true;
        await executeClaimedBrowserCommand(daemonUrl, claimant, command);
        break;
      }

      if (!matchedCommand) {
        break;
      }
    }

    return polledCommand;
  } finally {
    isPollingBrowserCommands = false;
  }
}

async function handleCapturePage(daemonUrl, message) {
  const tab = await resolveTargetTab(message);
  const pageContext = await collectPageContext(tab.id);
  const screenshotDataUrl = await captureTabScreenshot(tab.windowId);
  const selection = await saveSelectionToDaemon(daemonUrl, pageContext, screenshotDataUrl);
  await reportExtensionHeartbeatSafely(daemonUrl, {
    source: "popup:capture-page",
    page: pageContext.page,
  });

  return {
    ok: true,
    message: "Current page saved to the bridge.",
    selection,
  };
}

async function captureInspectScreenshot(windowId, message) {
  const screenshotDataUrl = await captureTabScreenshot(windowId);

  if (!message.captureRect) {
    return screenshotDataUrl;
  }

  return cropTabScreenshot(screenshotDataUrl, message.captureRect, message.pageContext?.viewport);
}

async function handleStartInspect(daemonUrl, message) {
  const tab = await resolveTargetTab(message);
  await ensureInteractiveAgentPicker(tab.id);
  await setInspectState(tab.id, daemonUrl);
  await enableInspectBadge(tab.id);

  const response = await sendMessageToTab(tab.id, {
    type: "agent-picker:start-inspect",
  });
  if (!response?.ok) {
    await clearInspectState(tab.id);
    throw new Error(response?.error || "Failed to arm inspect mode.");
  }

  await reportExtensionHeartbeatSafely(daemonUrl, {
    source: "popup:start-inspect",
    page: createPageRecordFromTab(tab),
  });

  return {
    ok: true,
    message: "Inspect mode armed. Click the target element in the page.",
  };
}

async function notifyInspectResult(tabId, payload) {
  await sendMessageToTab(tabId, {
    type: "agent-picker:inspect-result",
    ...payload,
  });
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

  const screenshot = await captureInspectScreenshot(windowId, message);
  const selection = await saveSelectionToDaemon(
    inspectState.daemonUrl,
    message.pageContext,
    screenshot,
  );
  await reportExtensionHeartbeatSafely(inspectState.daemonUrl, {
    source: "content-script:inspect-picked",
    page: message.pageContext?.page,
  });

  await clearInspectState(tabId);
  await notifyInspectResult(tabId, {
    ok: true,
    message: "Element saved to the local Agent Picker bridge.",
  });

  return {
    ok: true,
    message: "Element saved to the bridge.",
    selection,
  };
}

async function handleInspectFailure(message, sender, error) {
  if (sender.tab?.id && message?.type === "agent-picker:inspect-picked") {
    await clearInspectState(sender.tab.id);

    try {
      await notifyInspectResult(sender.tab.id, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Ignore follow-up notification failures after an inspect error.
    }
  }
}

async function executeBrowserCommand(tab, command) {
  switch (command?.type) {
    case "context":
      return {
        pageContext: await collectPageContext(tab.id),
      };
    case "dom":
    case "click":
    case "click-point":
    case "fill":
    case "key":
      return sendAgentCommandToTab(tab.id, command);
    case "screenshot": {
      const pageContext = await collectPageContext(tab.id);
      const dataUrl = await captureTabScreenshot(tab.windowId);
      return {
        page: pageContext.page,
        screenshot: {
          dataUrl,
          mimeType: "image/png",
          width: 0,
          height: 0,
          capturedAt: new Date().toISOString(),
        },
      };
    }
    default:
      throw new Error(`Unsupported Agent Picker browser command: ${String(command?.type)}`);
  }
}

async function handlePageHeartbeat(daemonUrl, message, sender) {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (!tabId || !windowId) {
    return {
      ok: true,
      polledCommand: false,
    };
  }

  const page = message?.page ?? createPageRecordFromTab(sender.tab);
  const source =
    message?.type === "agent-picker:page-ready"
      ? "content-script:page-ready"
      : "content-script:page-heartbeat";

  await reportExtensionHeartbeatSafely(daemonUrl, {
    source,
    page,
  });
  await reportBrowserSessionHeartbeatSafely(daemonUrl, {
    source,
    page,
    activeTabId: tabId,
    visible: message?.visibilityState === "visible",
    focused: message?.hasFocus === true,
  });
  const primaryClaimant = upsertKnownBrowserTab(sender, message);
  const polledCommand = await pollQueuedBrowserCommands(daemonUrl, primaryClaimant);
  return {
    ok: true,
    polledCommand,
  };
}

function createPageRecordFromTab(tab) {
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
    title: typeof tab?.title === "string" && tab.title.trim() ? tab.title.trim() : null,
  };
}
