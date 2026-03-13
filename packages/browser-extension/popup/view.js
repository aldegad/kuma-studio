const daemonUrlInput = document.getElementById("daemon-url");
const testBridgeButton = document.getElementById("test-bridge");
const capturePageButton = document.getElementById("capture-page");
const inspectElementButton = document.getElementById("inspect-element");
const statusElement = document.getElementById("status");
const lastSavedElement = document.getElementById("last-saved");

function setBusyState(isBusy) {
  for (const button of [testBridgeButton, capturePageButton, inspectElementButton]) {
    button.disabled = isBusy;
  }
}

function setStatus(message, tone = "idle") {
  statusElement.textContent = message;
  statusElement.className = `status status-${tone}`;
}

function setLastSaved(message = "") {
  lastSavedElement.textContent = message;
}

function updateSavedSelectionLabel(result) {
  if (result.selection?.page?.title) {
    setLastSaved(`Latest selection: ${result.selection.page.title}`);
    return;
  }

  if (result.selection?.page?.url) {
    setLastSaved(`Latest selection: ${result.selection.page.url}`);
    return;
  }

  setLastSaved("");
}
