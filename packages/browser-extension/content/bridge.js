function getInteractiveApi() {
  return globalThis.AgentPickerExtensionInteractive ?? null;
}

function getAgentActionsApi() {
  return globalThis.AgentPickerExtensionAgentActions ?? null;
}

async function sendPageHeartbeat() {
  try {
    await chrome.runtime.sendMessage({
      type: "agent-picker:page-heartbeat",
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
      case "agent-picker:collect-page":
        sendResponse({
          ok: true,
          pageContext: buildPageContext(getPageTargetElement()),
        });
        return;
      case "agent-picker:start-inspect":
        if (!getInteractiveApi()?.startInspectMode) {
          sendResponse({
            ok: false,
            error: "The Agent Picker inspect tools are not loaded for this page yet.",
          });
          return;
        }

        getInteractiveApi().startInspectMode();
        sendResponse({ ok: true });
        return;
      case "agent-picker:browser-command":
        if (!getAgentActionsApi()?.executeBrowserCommand) {
          sendResponse({
            ok: false,
            error: "The Agent Picker browser command tools are not loaded for this page yet.",
          });
          return;
        }

        try {
          const result = await getAgentActionsApi().executeBrowserCommand(message.command);
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
      case "agent-picker:inspect-result":
        getInteractiveApi()?.showToast?.(
          message.message || (message.ok ? "Element saved." : "Failed to save the picked element."),
          message.ok ? "info" : "error",
        );
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
  type: "agent-picker:page-ready",
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
