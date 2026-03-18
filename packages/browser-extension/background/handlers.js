let isPollingBrowserCommands = false;
const knownBrowserTabs = new Map();
const BROWSER_COMMAND_CAPABILITIES = [
  "context",
  "dom",
  "click",
  "click-point",
  "fill",
  "key",
  "screenshot",
  "wait-for-download",
  "get-latest-download",
  "wait-for-text",
  "wait-for-text-disappear",
  "wait-for-selector",
  "wait-for-dialog-close",
  "query-dom",
];

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
  let response = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await sendMessageToTab(tabId, {
      type: "agent-picker:browser-command",
      command,
    });

    if (response?.ok) {
      return response.result ?? null;
    }

    if (response?.error !== "The Agent Picker browser command tools are not loaded for this page yet.") {
      break;
    }

    await waitForDelay(150);
  }

  if (!response?.ok) {
    throw new Error(response?.error || "The active tab rejected the browser command.");
  }

  return response.result ?? null;
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
    // Do not block legacy command polling on best-effort session heartbeats.
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

async function upsertKnownBrowserTabFromTab(tab, overrides = {}) {
  if (!tab?.id || !tab.windowId || !tab.url) {
    return null;
  }

  let focused = overrides.focused;
  if (typeof focused !== "boolean") {
    try {
      const targetWindow = await chrome.windows.get(tab.windowId);
      focused = targetWindow.focused === true && tab.active === true;
    } catch {
      focused = false;
    }
  }

  const claimant = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    visible: typeof overrides.visible === "boolean" ? overrides.visible : tab.active === true,
    focused,
    lastSeenAt: new Date().toISOString(),
  };

  knownBrowserTabs.set(tab.id, claimant);
  return claimant;
}

async function publishPagePresence(daemonUrl, payload) {
  const { tab, page, source, visible, focused } = payload ?? {};
  if (!tab?.id || !tab.windowId) {
    return {
      ok: false,
      transportMode: await ensureDaemonTransport(daemonUrl),
      claimant: null,
    };
  }

  const claimant = await upsertKnownBrowserTabFromTab(tab, { visible, focused });
  const transportMode = await ensureDaemonTransport(daemonUrl);

  if (transportMode === "legacy-poll") {
    await reportExtensionHeartbeatSafely(daemonUrl, {
      source,
      page,
    });
    await reportBrowserSessionHeartbeatSafely(daemonUrl, {
      source,
      page,
      activeTabId: tab.id,
      visible: claimant?.visible === true,
      focused: claimant?.focused === true,
    });
    return {
      ok: true,
      transportMode,
      claimant,
    };
  }

  sendDaemonSocketMessage({
    type: "presence.update",
    source,
    page,
    activeTabId: tab.id,
    visible: claimant?.visible === true,
    focused: claimant?.focused === true,
    capabilities: BROWSER_COMMAND_CAPABILITIES,
    lastSeenAt: claimant?.lastSeenAt ?? new Date().toISOString(),
  });

  return {
    ok: true,
    transportMode,
    claimant,
  };
}

async function probeCurrentPageReadiness(daemonUrl, message) {
  try {
    const tab = await resolveTargetTab(message);
    const pageContext = await collectPageContext(tab.id);
    const presence = await publishPagePresence(daemonUrl, {
      source: "popup:current-page-probe",
      tab,
      page: pageContext.page,
    });

    return {
      ready: true,
      page: pageContext.page,
      tabId: tab.id,
      transportMode: presence.transportMode,
      message: "Current page is ready for Agent Picker commands.",
    };
  } catch (error) {
    return {
      ready: false,
      page: null,
      tabId: typeof message?.tabId === "number" ? message.tabId : null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
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

async function handleSocketCommandRequest(daemonUrl, message) {
  const requestId = typeof message?.requestId === "string" ? message.requestId : null;
  const command = message?.command;

  if (!requestId) {
    throw new Error("Missing requestId for the browser socket command.");
  }

  try {
    const tab = await resolveTargetTab({
      tabId: Number.isInteger(command?.resolvedTargetTabId) ? command.resolvedTargetTabId : command?.targetTabId,
      url: command?.targetUrl,
      urlContains: command?.targetUrlContains,
    });
    const resolvedCommand = {
      ...command,
      resolvedTargetTabId: tab.id,
    };
    const page = createPageRecordFromTab(tab);
    await publishPagePresence(daemonUrl, {
      source: "websocket:command-target",
      tab,
      page,
    });
    const result = await executeBrowserCommand(tab, resolvedCommand);
    sendDaemonSocketMessage({
      type: "command.result",
      requestId,
      result,
    });
  } catch (error) {
    if (Number.isInteger(command?.resolvedTargetTabId)) {
      knownBrowserTabs.delete(command.resolvedTargetTabId);
    }
    sendDaemonSocketMessage({
      type: "command.error",
      requestId,
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
    case "wait-for-text":
    case "wait-for-text-disappear":
    case "wait-for-selector":
    case "wait-for-dialog-close":
    case "query-dom":
      return sendAgentCommandToTab(tab.id, command);
    case "screenshot": {
      const pageContext = await collectPageContext(tab.id);
      const capture = await captureTargetTabScreenshot(tab, {
        focusTabFirst: command?.focusTabFirst !== false,
      });
      let screenshot = {
        dataUrl: capture.dataUrl,
        mimeType: "image/png",
        width: 0,
        height: 0,
        capturedAt: new Date().toISOString(),
      };
      let clip = null;

      const selector = typeof command?.selectorPath === "string" ? command.selectorPath : typeof command?.selector === "string" ? command.selector : null;
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
    case "wait-for-download": {
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
    case "get-latest-download": {
      const pageContext = await collectPageContext(tab.id);
      const { filter, record, permission } = await getLatestDownload(command, tab);
      return {
        page: pageContext.page,
        download: serializeDownloadResult(record, filter),
        permission: serializeDownloadPermission(permission),
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
  const primaryClaimant = upsertKnownBrowserTab(sender, message);
  const presence = await publishPagePresence(daemonUrl, {
    source,
    tab: sender.tab,
    page,
    visible: message?.visibilityState === "visible",
    focused: message?.hasFocus === true,
  });

  if (presence.transportMode === "legacy-poll") {
    const polledCommand = await pollQueuedBrowserCommands(daemonUrl, primaryClaimant);
    return {
      ok: true,
      polledCommand,
      transportMode: presence.transportMode,
    };
  }
  return {
    ok: true,
    polledCommand: false,
    transportMode: presence.transportMode,
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
