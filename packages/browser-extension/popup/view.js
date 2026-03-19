const daemonUrlInput = document.getElementById("daemon-url");
const connectDaemonButton = document.getElementById("connect-daemon");
const capturePageButton = document.getElementById("capture-page");
const inspectElementButton = document.getElementById("inspect-element");
const inspectWithJobButton = document.getElementById("inspect-with-job");
const copyRefactorPromptButton = document.getElementById("copy-refactor-prompt");
const refactorPromptElement = document.getElementById("refactor-prompt");
const connectionFormElement = document.getElementById("connection-form");
const connectionStatusElement = document.getElementById("connection-status");
const connectionDotElement = document.getElementById("connection-dot");
const connectionLabelElement = document.getElementById("connection-label");
const connectionUrlElement = document.getElementById("connection-url");
const pageStatusElement = document.getElementById("page-status");
const pageStatusDotElement = document.getElementById("page-status-dot");
const pageStatusLabelElement = document.getElementById("page-status-label");
const pageStatusMetaElement = document.getElementById("page-status-meta");
const pageStatusControlsElement = document.getElementById("page-status-controls");
const pageTabIdElement = document.getElementById("page-tab-id");
const copyPageTabIdButton = document.getElementById("copy-page-tab-id");
const feedbackElement = document.getElementById("feedback");
const lastSavedElement = document.getElementById("last-saved");
let isBusy = false;
let isConnected = false;
let isCurrentPageReady = false;
let currentPageTabId = null;

function syncButtonState() {
  connectDaemonButton.disabled = isBusy;
  capturePageButton.disabled = isBusy || !isConnected || !isCurrentPageReady;
  inspectElementButton.disabled = isBusy || !isConnected || !isCurrentPageReady;
  inspectWithJobButton.disabled = isBusy || !isConnected || !isCurrentPageReady;
}

function setBusyState(busyState) {
  isBusy = busyState;
  syncButtonState();
}

function setActionAvailability(connectedState, currentPageReadyState = false) {
  isConnected = connectedState;
  isCurrentPageReady = currentPageReadyState;
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

function setCurrentPageTabId(tabId) {
  currentPageTabId = Number.isInteger(tabId) ? tabId : null;
  const hasTabId = currentPageTabId !== null;
  pageStatusControlsElement.classList.toggle("is-hidden", !hasTabId);
  pageTabIdElement.textContent = hasTabId ? `Tab ID ${currentPageTabId}` : "";
  copyPageTabIdButton.disabled = !hasTabId;
}

async function copyCurrentPageTabId() {
  if (currentPageTabId === null) {
    return;
  }

  try {
    const tabIdArgument = `--tab-id ${currentPageTabId}`;
    await navigator.clipboard.writeText(tabIdArgument);
    setFeedback(`${tabIdArgument} copied.`, "success");
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), "error");
  }
}

function setConnectionState({
  state,
  label,
  url,
  showForm,
  pageState = "checking",
  pageLabel = "",
  pageMeta = "",
  pageTabId = null,
}) {
  connectionStatusElement.dataset.state = state;
  connectionDotElement.className = `status-dot status-dot-${state}`;
  connectionLabelElement.textContent = label;
  connectionUrlElement.textContent = url;
  connectionFormElement.classList.toggle("is-hidden", !showForm);
  pageStatusElement.dataset.state = pageState;
  pageStatusDotElement.className = `status-dot status-dot-${pageState === "ready" ? "connected" : pageState === "checking" ? "checking" : "error"}`;
  pageStatusLabelElement.textContent = pageLabel;
  pageStatusMetaElement.textContent = pageMeta;
  setCurrentPageTabId(pageTabId);
  setActionAvailability(state === "connected", pageState === "ready");
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

copyPageTabIdButton.addEventListener("click", () => {
  void copyCurrentPageTabId();
});
