/* global clearInspectState, invalidateInteractiveKumaPicker, invalidateAutomationBridge,
   removeKnownBrowserTab,
   reportExtensionHeartbeat, getStoredDaemonUrl, setStoredDaemonUrl, fetchDaemonHealth,
   ensureDaemonTransport, waitForDaemonSocketReady, getDaemonSocketDiagnostics,
   probeCurrentPageReadiness, handlePageHeartbeat, ensureRuntimeObserver,
   handleStartInspect, handleInspectPicked, handleRecordingFinished,
   serializeLiveCaptureState, openLiveCaptureStudio, getLiveCaptureStudioContext,
   handleStudioLiveCaptureStarted, abortStudioLiveCapture, prepareLiveCapture, discardPreparedLiveCapture,
   startLiveCapture, stopLiveCapture, handleLiveCaptureFinished,
   writeJobCardUpdate, deleteJobCard, handleInspectFailure */

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearInspectState(tabId);
  invalidateInteractiveKumaPicker(tabId);
  invalidateAutomationBridge(tabId);
  removeKnownBrowserTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    invalidateInteractiveKumaPicker(tabId);
    invalidateAutomationBridge(tabId);
  }
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
    try {
      const daemonUrl = await getStoredDaemonUrl();
      await ensureDaemonTransport(daemonUrl, { force: true });
      await reportStoredExtensionHeartbeat("runtime:on-installed");
    } catch (err) {
      console.error("[kuma-studio] onInstalled bootstrap error:", err);
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    try {
      const daemonUrl = await getStoredDaemonUrl();
      await ensureDaemonTransport(daemonUrl, { force: true });
      await reportStoredExtensionHeartbeat("runtime:on-startup");
    } catch (err) {
      console.error("[kuma-studio] onStartup bootstrap error:", err);
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
            currentPageViewport: pageProbe.viewport ?? null,
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
        case "kuma-picker:start-inspect":
          sendResponse(await handleStartInspect(daemonUrl, message));
          return;
        case "kuma-picker:inspect-picked":
          sendResponse(await handleInspectPicked(message, sender));
          return;
        case "kuma-picker:recording-finished":
          sendResponse(await handleRecordingFinished(message));
          return;
        case "kuma-picker:get-live-capture-state":
          sendResponse({
            ok: true,
            ...serializeLiveCaptureState(),
          });
          return;
        case "kuma-picker:open-live-capture-studio":
          sendResponse(await openLiveCaptureStudio(message));
          return;
        case "kuma-picker:get-live-capture-studio-context":
          sendResponse(await getLiveCaptureStudioContext(message, sender));
          return;
        case "kuma-picker:studio-live-capture-started":
          sendResponse(await handleStudioLiveCaptureStarted(message, sender));
          return;
        case "kuma-picker:studio-live-capture-abort":
          sendResponse(abortStudioLiveCapture(message, sender));
          return;
        case "kuma-picker:prepare-live-capture":
          sendResponse(await prepareLiveCapture(message));
          return;
        case "kuma-picker:discard-live-capture-prepare":
          sendResponse(await discardPreparedLiveCapture(message));
          return;
        case "kuma-picker:start-live-capture":
          sendResponse(await startLiveCapture(message));
          return;
        case "kuma-picker:stop-live-capture":
          sendResponse(await stopLiveCapture());
          return;
        case "kuma-picker:live-capture-finished":
          sendResponse(await handleLiveCaptureFinished(message));
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
        case "kuma-picker:dismiss-job-card":
          sendResponse({
            ok: true,
            card: await deleteJobCard(
              daemonUrl,
              typeof message?.sessionId === "string" ? message.sessionId : null,
            ),
          });
          return;
        case "kuma-picker:cancel-inspect":
          if (sender.tab?.id) {
            await clearInspectState(sender.tab.id);
          }
          sendResponse({ ok: true });
          return;
        case "captureVisibleTab": {
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
          sendResponse({ dataUrl });
          return;
        }
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
