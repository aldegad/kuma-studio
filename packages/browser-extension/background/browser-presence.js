const knownBrowserTabs = new Map();
const BROWSER_COMMAND_CAPABILITIES = ["run", "screenshot"];
const KNOWN_TAB_MAX_AGE_MS = 300_000; // 5 minutes

function removeKnownBrowserTab(tabId) {
  knownBrowserTabs.delete(tabId);
}

function pruneKnownBrowserTabs() {
  const cutoff = new Date(Date.now() - KNOWN_TAB_MAX_AGE_MS).toISOString();
  for (const [tabId, entry] of knownBrowserTabs) {
    if (entry.lastSeenAt < cutoff) {
      knownBrowserTabs.delete(tabId);
    }
  }
}

setInterval(pruneKnownBrowserTabs, 60_000);

async function reportExtensionHeartbeatSafely(daemonUrl, payload) {
  try {
    await reportExtensionHeartbeat(daemonUrl, payload);
  } catch {
    // Do not block the main capture flow on best-effort presence reporting.
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
  const { tab, page, source, visible, focused, browserUserAgent } = payload ?? {};
  if (!tab?.id || !tab.windowId) {
    return {
      ok: false,
      transportMode: await ensureDaemonTransport(daemonUrl),
      claimant: null,
    };
  }

  const claimant = await upsertKnownBrowserTabFromTab(tab, { visible, focused });
  const transportMode = await ensureDaemonTransport(daemonUrl);
  await reportExtensionHeartbeatSafely(daemonUrl, {
    source,
    page,
  });

  sendDaemonSocketMessage({
    type: "presence.update",
    source,
    page,
    activeTabId: tab.id,
    visible: claimant?.visible === true,
    focused: claimant?.focused === true,
    capabilities: BROWSER_COMMAND_CAPABILITIES,
    lastSeenAt: claimant?.lastSeenAt ?? new Date().toISOString(),
    browserUserAgent: typeof browserUserAgent === "string" ? browserUserAgent : null,
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
      viewport: pageContext.viewport ?? null,
      tabId: tab.id,
      transportMode: presence.transportMode,
      message: "Current page is ready for Kuma Picker commands.",
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

function cardTargetsTab(card, tab) {
  const target = card?.target ?? null;
  if (!target || !tab?.id || !tab?.url) {
    return false;
  }

  if (Number.isInteger(target.tabId)) {
    return target.tabId === tab.id;
  }

  if (typeof target.url === "string" && target.url.trim()) {
    return target.url.trim() === tab.url;
  }

  if (typeof target.urlContains === "string" && target.urlContains.trim()) {
    return tab.url.includes(target.urlContains.trim());
  }

  return false;
}

async function syncJobCardsForTab(daemonUrl, tab) {
  if (!tab?.id) {
    return;
  }

  try {
    const feed = await fetchJobCardFeed(daemonUrl);
    const cards = Array.isArray(feed?.cards) ? feed.cards : [];

    for (const card of cards.filter((entry) => cardTargetsTab(entry, tab))) {
      await sendMessageToTab(tab.id, {
        type: "kuma-picker:job-card-event",
        id: card?.id ?? null,
        deleted: false,
        card,
        source: "job-card-sync",
      });
    }
  } catch {
    // Ignore best-effort sync failures while keeping page presence alive.
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
    message?.type === "kuma-picker:page-ready"
      ? "content-script:page-ready"
      : "content-script:page-heartbeat";
  upsertKnownBrowserTab(sender, message);
  const presence = await publishPagePresence(daemonUrl, {
    source,
    tab: sender.tab,
    page,
    visible: message?.visibilityState === "visible",
    focused: message?.hasFocus === true,
    browserUserAgent: typeof message?.browserUserAgent === "string" ? message.browserUserAgent : null,
  });

  if (message?.type === "kuma-picker:page-ready") {
    await syncJobCardsForTab(daemonUrl, sender.tab);
  }

  return {
    ok: true,
    polledCommand: false,
    transportMode: presence.transportMode,
  };
}
