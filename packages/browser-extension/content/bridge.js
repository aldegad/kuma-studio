if (!globalThis.KumaPickerExtensionBridgeInitialized) {
  globalThis.KumaPickerExtensionBridgeInitialized = true;

  function getInteractiveApi() {
    return globalThis.KumaPickerExtensionInteractive ?? null;
  }

  function getAutomationApi() {
    return globalThis.KumaPickerExtensionPlaywrightRuntime ?? null;
  }

  function getJobCardsApi() {
    return globalThis.KumaPickerExtensionJobCards ?? null;
  }

  async function sendPageHeartbeat() {
    try {
      await chrome.runtime.sendMessage({
        type: "kuma-picker:page-heartbeat",
        page: buildPageRecord(),
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      });
    } catch {
      // Ignore teardown or reload races.
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      switch (message?.type) {
        case "kuma-picker:collect-page":
          sendResponse({
            ok: true,
            pageContext: buildPageContext(getPageTargetElement()),
          });
          return;
        case "kuma-picker:start-inspect":
          if (!getInteractiveApi()?.startInspectMode) {
            sendResponse({
              ok: false,
              error: "The Kuma Picker inspect tools are not loaded for this page yet.",
            });
            return;
          }

          getInteractiveApi().startInspectMode({
            withJob: message?.withJob === true,
          });
          sendResponse({ ok: true });
          return;
        case "kuma-picker:automation-command":
          if (!getAutomationApi()?.executeAutomationCommand) {
            sendResponse({
              ok: false,
              error: "The Kuma Picker automation runtime is not loaded for this page yet.",
            });
            return;
          }

          try {
            const result = await getAutomationApi().executeAutomationCommand(message.command);
            sendResponse({
              ok: true,
              result,
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        case "kuma-picker:inspect-result":
          getInteractiveApi()?.showToast?.(
            message.message || (message.ok ? "Element saved." : "Failed to save the picked element."),
            message.ok ? "info" : "error",
          );
          sendResponse({ ok: true });
          return;
        case "kuma-picker:job-card-event":
          getJobCardsApi()?.applyJobCardEvent?.(message);
          sendResponse({ ok: true });
          return;
        case "kuma-picker:recording-overlay-mode":
          globalThis.KumaPickerExtensionAgentGestureOverlay?.setRecordingMode?.(message.active === true);
          sendResponse({ ok: true });
          return;
        default:
          sendResponse({
            ok: false,
            error: `Unknown message type: ${String(message?.type)}`,
          });
      }
    })();

    return true;
  });

  void chrome.runtime.sendMessage({
    type: "kuma-picker:page-ready",
    page: buildPageRecord(),
  });
  void sendPageHeartbeat();
  window.setInterval(sendPageHeartbeat, 2_000);
  document.addEventListener("visibilitychange", () => {
    void sendPageHeartbeat();
  });
  window.addEventListener("focus", () => {
    void sendPageHeartbeat();
  });
}
