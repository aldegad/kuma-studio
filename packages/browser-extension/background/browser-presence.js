let isPollingBrowserCommands = false;
const knownBrowserTabs = new Map();
const BROWSER_COMMAND_CAPABILITIES = [
  "context",
  "dom",
  "console",
  "debugger-capture",
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
];

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
