const daemonUrlInput = document.getElementById("daemon-url");
const connectDaemonButton = document.getElementById("connect-daemon");
const capturePageButton = document.getElementById("capture-page");
const inspectElementButton = document.getElementById("inspect-element");
const copyRefactorPromptButton = document.getElementById("copy-refactor-prompt");
const refactorPromptElement = document.getElementById("refactor-prompt");
const connectionFormElement = document.getElementById("connection-form");
const connectionDotElement = document.getElementById("connection-dot");
const connectionLabelElement = document.getElementById("connection-label");
const connectionUrlElement = document.getElementById("connection-url");
const feedbackElement = document.getElementById("feedback");
const lastSavedElement = document.getElementById("last-saved");
let isBusy = false;
let isConnected = false;

function syncButtonState() {
  connectDaemonButton.disabled = isBusy;
  capturePageButton.disabled = isBusy || !isConnected;
  inspectElementButton.disabled = isBusy || !isConnected;
}

function setBusyState(busyState) {
  isBusy = busyState;
  syncButtonState();
}

function setActionAvailability(connectedState) {
  isConnected = connectedState;
  syncButtonState();
}

function setFeedback(message = "", tone = "idle") {
  feedbackElement.textContent = message;
  feedbackElement.className = `feedback feedback-${tone}`;
}

function setLastSaved(message = "") {
  lastSavedElement.textContent = message;
}

function setRefactorPrompt(message) {
  refactorPromptElement.value = message;
}

function setConnectionState({ state, label, url, showForm }) {
  connectionDotElement.className = `status-dot status-dot-${state}`;
  connectionLabelElement.textContent = label;
  connectionUrlElement.textContent = url;
  connectionFormElement.classList.toggle("is-hidden", !showForm);
  setActionAvailability(state === "connected");
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
