function getInteractiveApi() {
  return globalThis.AgentPickerExtensionInteractive ?? null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case "agent-picker:collect-page":
      sendResponse({
        ok: true,
        pageContext: buildPageContext(getPageTargetElement()),
      });
      return false;
    case "agent-picker:start-inspect":
      if (!getInteractiveApi()?.startInspectMode) {
        sendResponse({
          ok: false,
          error: "The Agent Picker inspect tools are not loaded for this page yet.",
        });
        return false;
      }

      getInteractiveApi().startInspectMode();
      sendResponse({ ok: true });
      return false;
    case "agent-picker:inspect-result":
      getInteractiveApi()?.showToast?.(
        message.message || (message.ok ? "Element saved." : "Failed to save the picked element."),
        message.ok ? "info" : "error",
      );
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

void chrome.runtime.sendMessage({
  type: "agent-picker:page-ready",
  page: buildPageRecord(),
});
