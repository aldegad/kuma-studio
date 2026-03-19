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

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const daemonUrl = await getStoredDaemonUrl();
    await ensureDaemonTransport(daemonUrl, { force: true });
    await reportStoredExtensionHeartbeat("runtime:on-installed");
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    const daemonUrl = await getStoredDaemonUrl();
    await ensureDaemonTransport(daemonUrl, { force: true });
    await reportStoredExtensionHeartbeat("runtime:on-startup");
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
        case "kuma-picker:test-daemon":
          const health = await fetchDaemonHealth(daemonUrl);
          const transportMode = await ensureDaemonTransport(daemonUrl, { force: true });
          const diagnostics =
            transportMode === "websocket"
              ? await waitForDaemonSocketReady()
              : getDaemonSocketDiagnostics();
          const pageProbe =
            transportMode === "websocket" && diagnostics.socketConnected === true
              ? await probeCurrentPageReadiness(daemonUrl, message)
              : { ready: false, page: null, tabId: message?.tabId ?? null, message: "Current page readiness was not checked." };
          if (transportMode === "websocket" && diagnostics.socketConnected !== true) {
            sendResponse({
              ok: false,
              healthOk: true,
              browserTransport: health?.browserTransport ?? transportMode,
              socketConnected: diagnostics.socketConnected === true,
              socketStatus: diagnostics.socketStatus,
              lastSocketError: diagnostics.lastSocketError,
              currentPageReady: false,
              currentPage: null,
              currentPageTabId: message?.tabId ?? null,
              currentPageMessage: "The current page cannot be checked until the WebSocket bridge connects.",
              message: diagnostics.lastSocketError || "Daemon health check passed, but the WebSocket bridge did not connect.",
            });
            return;
          }
          sendResponse({
            ok: true,
            healthOk: true,
            browserTransport: health?.browserTransport ?? transportMode,
            socketConnected: diagnostics.socketConnected === true,
            socketStatus: diagnostics.socketStatus,
            lastSocketError: diagnostics.lastSocketError,
            currentPageReady: pageProbe.ready === true,
            currentPage: pageProbe.page ?? null,
            currentPageTabId: pageProbe.tabId ?? message?.tabId ?? null,
            currentPageMessage: pageProbe.message,
            message:
              pageProbe.ready === true
                ? `Bridge reachable at ${daemonUrl}, WebSocket connected, and the current page is ready.`
                : `Bridge reachable at ${daemonUrl}, but the current page is not ready for Kuma Picker commands.`,
          });
          return;
        case "kuma-picker:page-ready":
          sendResponse(await handlePageHeartbeat(daemonUrl, message, sender));
          return;
        case "kuma-picker:page-heartbeat":
          sendResponse(await handlePageHeartbeat(daemonUrl, message, sender));
          return;
        case "kuma-picker:ensure-runtime-observer":
          if (!sender.tab?.id) {
            sendResponse({ ok: false, error: "No target tab is available for the runtime observer." });
            return;
          }
          await ensureRuntimeObserver(sender.tab.id, typeof sender.frameId === "number" ? sender.frameId : 0);
          sendResponse({ ok: true });
          return;
        case "kuma-picker:capture-page":
          sendResponse(await handleCapturePage(daemonUrl, message));
          return;
        case "kuma-picker:start-inspect":
          sendResponse(await handleStartInspect(daemonUrl, message));
          return;
        case "kuma-picker:inspect-picked":
          sendResponse(await handleInspectPicked(message, sender));
          return;
        case "kuma-picker:update-job-card-position":
          sendResponse(
            await writeJobCardUpdate(daemonUrl, {
              id: typeof message?.id === "string" ? message.id : null,
              sessionId: typeof message?.sessionId === "string" ? message.sessionId : null,
              position:
                message?.position &&
                typeof message.position === "object" &&
                typeof message.position.left === "number" &&
                Number.isFinite(message.position.left) &&
                typeof message.position.top === "number" &&
                Number.isFinite(message.position.top)
                  ? {
                      left: message.position.left,
                      top: message.position.top,
                    }
                  : null,
              preserveUpdatedAt: true,
            }),
          );
          return;
        case "kuma-picker:cancel-inspect":
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
