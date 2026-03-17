chrome.tabs.onRemoved.addListener((tabId) => {
  void clearInspectState(tabId);
});

async function reportStoredExtensionHeartbeat(source, page = null) {
  try {
    await reportExtensionHeartbeat(await getStoredDaemonUrl(), {
      source,
      page,
    });
  } catch {
    // Ignore daemon availability issues for passive status updates.
  }
}

async function reportStoredBrowserSessionHeartbeat(source, page = null) {
  try {
    await reportBrowserSessionHeartbeat(await getStoredDaemonUrl(), {
      source,
      page,
      activeTabId: null,
    });
  } catch {
    // Ignore daemon availability issues for passive session updates.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const daemonUrl = await getStoredDaemonUrl();
    const transportMode = await ensureDaemonTransport(daemonUrl, { force: true });
    if (transportMode === "legacy-poll") {
      await reportStoredExtensionHeartbeat("runtime:on-installed");
      await reportStoredBrowserSessionHeartbeat("runtime:on-installed");
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    const daemonUrl = await getStoredDaemonUrl();
    const transportMode = await ensureDaemonTransport(daemonUrl, { force: true });
    if (transportMode === "legacy-poll") {
      await reportStoredExtensionHeartbeat("runtime:on-startup");
      await reportStoredBrowserSessionHeartbeat("runtime:on-startup");
    }
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      const daemonUrl =
        typeof message?.daemonUrl === "string"
          ? await setStoredDaemonUrl(message.daemonUrl)
          : await getStoredDaemonUrl();

      switch (message?.type) {
        case "agent-picker:test-daemon":
          const health = await fetchDaemonHealth(daemonUrl);
          const transportMode = await ensureDaemonTransport(daemonUrl, { force: true });
          const diagnostics =
            transportMode === "websocket"
              ? await waitForDaemonSocketReady()
              : getDaemonSocketDiagnostics();
          if (transportMode === "websocket" && diagnostics.socketConnected !== true) {
            sendResponse({
              ok: false,
              healthOk: true,
              browserTransport: health?.browserTransport ?? transportMode,
              socketConnected: diagnostics.socketConnected === true,
              socketStatus: diagnostics.socketStatus,
              lastSocketError: diagnostics.lastSocketError,
              message: diagnostics.lastSocketError || "Daemon health check passed, but the WebSocket bridge did not connect.",
            });
            return;
          }
          sendResponse({
            ok: true,
            healthOk: true,
            browserTransport: health?.browserTransport ?? transportMode,
            socketConnected: diagnostics.socketConnected === true || transportMode === "legacy-poll",
            socketStatus: diagnostics.socketStatus,
            lastSocketError: diagnostics.lastSocketError,
            message:
              transportMode === "legacy-poll"
                ? `Bridge reachable at ${daemonUrl} using legacy polling mode.`
                : `Bridge reachable at ${daemonUrl} and WebSocket connected.`,
          });
          return;
        case "agent-picker:page-ready":
          sendResponse(await handlePageHeartbeat(daemonUrl, message, sender));
          return;
        case "agent-picker:page-heartbeat":
          sendResponse(await handlePageHeartbeat(daemonUrl, message, sender));
          return;
        case "agent-picker:capture-page":
          sendResponse(await handleCapturePage(daemonUrl, message));
          return;
        case "agent-picker:start-inspect":
          sendResponse(await handleStartInspect(daemonUrl, message));
          return;
        case "agent-picker:inspect-picked":
          sendResponse(await handleInspectPicked(message, sender));
          return;
        case "agent-picker:cancel-inspect":
          if (sender.tab?.id) {
            await clearInspectState(sender.tab.id);
          }
          sendResponse({ ok: true });
          return;
        default:
          sendResponse({
            ok: false,
            error: `Unknown message type: ${String(message?.type)}`,
          });
      }
    } catch (error) {
      await handleInspectFailure(message, sender, error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});
