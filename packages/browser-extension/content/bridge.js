chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case "agent-picker:collect-page":
      sendResponse({
        ok: true,
        pageContext: buildPageContext(getPageTargetElement()),
      });
      return false;
    case "agent-picker:start-inspect":
      startInspectMode();
      sendResponse({ ok: true });
      return false;
    case "agent-picker:inspect-result":
      showToast(
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
