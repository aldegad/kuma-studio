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
  void reportStoredExtensionHeartbeat("runtime:on-installed");
});

chrome.runtime.onStartup.addListener(() => {
  void reportStoredExtensionHeartbeat("runtime:on-startup");
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
          await fetchDaemonHealth(daemonUrl);
          await reportStoredExtensionHeartbeat("popup:test-daemon");
          sendResponse({
            ok: true,
            message: `Bridge reachable at ${daemonUrl}.`,
          });
          return;
        case "agent-picker:page-ready":
          await reportStoredExtensionHeartbeat("content-script:page-ready", message?.page ?? null);
          sendResponse({ ok: true });
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
