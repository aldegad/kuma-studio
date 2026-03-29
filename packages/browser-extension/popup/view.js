const daemonUrlInput = document.getElementById("daemon-url");
const connectDaemonButton = document.getElementById("connect-daemon");
const connectDaemonIcon = document.getElementById("connect-daemon-icon");
const inspectElementButton = document.getElementById("inspect-element");
const inspectWithJobButton = document.getElementById("inspect-with-job");
const copyRefactorPromptButton = document.getElementById("copy-refactor-prompt");
const refactorPromptElement = document.getElementById("refactor-prompt");
const connectionStatusElement = document.getElementById("connection-status");
const connectionDotElement = document.getElementById("connection-dot");
const connectionLabelElement = document.getElementById("connection-label");
const connectionUrlElement = document.getElementById("connection-url");
const pageStatusElement = document.getElementById("page-status");
const pageStatusDotElement = document.getElementById("page-status-dot");
const pageStatusLabelElement = document.getElementById("page-status-label");
const pageStatusMetaElement = document.getElementById("page-status-meta");
const pageTabIdElement = document.getElementById("page-tab-id");
const copyPageTabIdButton = document.getElementById("copy-page-tab-id");
const liveCaptureStatusElement = document.getElementById("live-capture-status");
const liveCaptureDotElement = document.getElementById("live-capture-dot");
const liveCaptureLabelElement = document.getElementById("live-capture-label");
const liveCaptureMetaElement = document.getElementById("live-capture-meta");
const liveCaptureSourceChipElement = document.getElementById("live-capture-source-chip");
const liveCaptureSourceIconElement = document.getElementById("live-capture-source-icon");
const liveCaptureSourceLabelElement = document.getElementById("live-capture-source-label");
const liveCaptureSourceElements = Array.from(document.querySelectorAll('input[name="live-capture-source"]'));
const startLiveCaptureButton = document.getElementById("start-live-capture");
const stopLiveCaptureButton = document.getElementById("stop-live-capture");
const captureSelectorPanelElement = document.getElementById("capture-selector-panel");
const captureSelectorTitleElement = document.getElementById("capture-selector-title");
const captureSelectorMetaElement = document.getElementById("capture-selector-meta");
const captureSelectorHintElement = document.getElementById("capture-selector-hint");
const captureSelectorCloseButton = document.getElementById("capture-selector-close");
const captureSelectorFullButton = document.getElementById("capture-selector-full");
const captureSelectorStartButton = document.getElementById("capture-selector-start");
const capturePreviewStageElement = document.getElementById("capture-preview-stage");
const capturePreviewImageElement = document.getElementById("capture-preview-image");
const captureSelectionBoxElement = document.getElementById("capture-selection-box");
const captureSelectionSizeElement = document.getElementById("capture-selection-size");
const feedbackElement = document.getElementById("feedback");
const feedbackMessageElement = document.getElementById("feedback-message");
const feedbackShortcutElement = document.getElementById("feedback-shortcut");
const lastSavedElement = document.getElementById("last-saved");
let isBusy = false;
let isConnected = false;
let isCurrentPageReady = false;
let isLiveCaptureActive = false;
let isCaptureSelectorActive = false;
let currentPageTabId = null;
let isEditingConnectionUrl = false;
let liveCaptureStateValue = "idle";
const DEFAULT_FOOTER_MESSAGE = "Click to pick an element, or drag to capture an area.";

function getLiveCaptureSourceUi(source) {
  switch (source) {
    case "window":
      return {
        label: "Window",
        idleMeta: "Window selected",
        startLabel: "Open Window Studio",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5A2.25 2.25 0 0 1 19.5 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 17.25z" /><path d="M8 9h8" /><path d="M8 12h8" /></svg>',
      };
    case "screen":
      return {
        label: "Screen",
        idleMeta: "Screen selected",
        startLabel: "Open Screen Studio",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5A2.25 2.25 0 0 1 19.5 6.75v7.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 14.25z" /><path d="M9.5 19.5h5" /><path d="M12 16.5v3" /></svg>',
      };
    default:
      return {
        label: "Current tab",
        idleMeta: "Current tab selected",
        startLabel: "Start Tab Capture",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5A2.25 2.25 0 0 1 19.5 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 17.25z" /><path d="M4.5 8.5h15" /></svg>',
      };
  }
}

function updateLiveCaptureSourceUi() {
  const source = getSelectedLiveCaptureSourceValue();
  const sourceUi = getLiveCaptureSourceUi(source);
  liveCaptureSourceChipElement.dataset.source = source;
  liveCaptureSourceIconElement.innerHTML = sourceUi.icon;
  liveCaptureSourceLabelElement.textContent = sourceUi.label;
  if (liveCaptureStateValue !== "recording" && liveCaptureStateValue !== "error") {
    liveCaptureMetaElement.textContent = sourceUi.idleMeta;
    liveCaptureMetaElement.classList.remove("is-hidden");
  }
  startLiveCaptureButton.textContent = sourceUi.startLabel;
}

function getSelectedLiveCaptureSourceValue() {
  const selected = liveCaptureSourceElements.find((input) => input.checked);
  const value = typeof selected?.value === "string" ? selected.value : "tab";
  return value === "window" || value === "screen" ? value : "tab";
}

function setSelectedLiveCaptureSourceValue(source) {
  const normalizedSource = KumaPickerExtensionLiveCaptureSettings.normalizeSource(source);
  liveCaptureSourceElements.forEach((input) => {
    input.checked = input.value === normalizedSource;
  });
  updateLiveCaptureSourceUi();
  syncButtonState();
}

function canStartLiveCapture() {
  const selectedSource = getSelectedLiveCaptureSourceValue();
  if (selectedSource === "window" || selectedSource === "screen") {
    return isConnected && currentPageTabId !== null && !isLiveCaptureActive;
  }

  return isConnected && isCurrentPageReady && !isLiveCaptureActive;
}

function syncButtonState() {
  connectDaemonButton.disabled = isBusy;
  inspectElementButton.disabled = isBusy || !isConnected || !isCurrentPageReady;
  inspectWithJobButton.disabled = isBusy || !isConnected || !isCurrentPageReady;
  startLiveCaptureButton.disabled = isBusy || isCaptureSelectorActive || !canStartLiveCapture();
  stopLiveCaptureButton.disabled = isBusy || !isLiveCaptureActive;
  liveCaptureSourceElements.forEach((input) => {
    input.disabled = isBusy || isLiveCaptureActive;
  });
  captureSelectorCloseButton.disabled = isBusy;
  captureSelectorFullButton.disabled = isBusy;
  captureSelectorStartButton.disabled = isBusy;
}

function updateConnectionEditUi() {
  connectionUrlElement.classList.toggle("is-hidden", isEditingConnectionUrl);
  daemonUrlInput.classList.toggle("is-hidden", !isEditingConnectionUrl);
  connectDaemonButton.setAttribute("aria-label", isEditingConnectionUrl ? "Apply bridge URL" : "Edit bridge URL");
  connectDaemonButton.setAttribute("title", isEditingConnectionUrl ? "Apply bridge URL" : "Edit bridge URL");
  connectDaemonIcon.innerHTML = isEditingConnectionUrl
    ? '<path d="M5 12.5l4.25 4.25L19 7" />'
    : '<path d="M4 20l4.5-1 9.25-9.25a1.5 1.5 0 0 0 0-2.12l-1.38-1.38a1.5 1.5 0 0 0-2.12 0L5 15.5 4 20z" /><path d="M13.5 7.5l3 3" />';
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
  feedbackMessageElement.textContent = message || DEFAULT_FOOTER_MESSAGE;
  feedbackShortcutElement.classList.toggle("is-hidden", Boolean(message));
  feedbackElement.className = `feedback feedback-${tone}`;
}

function setLastSaved(message = "") {
  lastSavedElement.textContent = message;
}

function setRefactorPrompt(message) {
  refactorPromptElement.value = message;
}

function isConnectionEditMode() {
  return isEditingConnectionUrl;
}

function setConnectionEditMode(editing, { focus = false, resetValue = false } = {}) {
  isEditingConnectionUrl = editing === true;
  if (resetValue) {
    daemonUrlInput.value = connectionUrlElement.textContent || "";
  }
  updateConnectionEditUi();
  if (isEditingConnectionUrl && focus) {
    daemonUrlInput.focus();
    daemonUrlInput.select();
  }
}

function setCurrentPageTabId(tabId) {
  currentPageTabId = Number.isInteger(tabId) ? tabId : null;
  const hasTabId = currentPageTabId !== null;
  pageTabIdElement.classList.toggle("is-hidden", !hasTabId);
  pageTabIdElement.textContent = hasTabId ? String(currentPageTabId) : "";
  copyPageTabIdButton.classList.toggle("is-hidden", !hasTabId);
  copyPageTabIdButton.disabled = !hasTabId;
}

function setLiveCaptureState({ state = "idle", label = "", meta = "", active = false }) {
  isLiveCaptureActive = active === true;
  liveCaptureStateValue = state;
  liveCaptureStatusElement.dataset.state = state;
  liveCaptureDotElement.className = `status-dot status-dot-${state === "recording" ? "checking" : state === "error" ? "error" : "connected"}`;
  liveCaptureLabelElement.textContent = label;
  if (meta) {
    liveCaptureMetaElement.textContent = meta;
    liveCaptureMetaElement.classList.remove("is-hidden");
  } else {
    updateLiveCaptureSourceUi();
  }
  liveCaptureStatusElement.open = active === true || state === "error";
  syncButtonState();
}

function setCaptureSelectorState({
  active = false,
  title = "Frame your capture",
  meta = "",
  hint = "",
  startLabel = "Start Selected Capture",
} = {}) {
  isCaptureSelectorActive = active === true;
  captureSelectorPanelElement.classList.toggle("is-hidden", !isCaptureSelectorActive);
  captureSelectorTitleElement.textContent = title;
  captureSelectorMetaElement.textContent = meta;
  captureSelectorHintElement.textContent = hint;
  captureSelectorStartButton.textContent = startLabel;
  syncButtonState();
}

async function copyCurrentPageTabId() {
  if (currentPageTabId === null) {
    return;
  }

  try {
    await navigator.clipboard.writeText(String(currentPageTabId));
    setFeedback("Tab ID copied.", "success");
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
  daemonUrlInput.value = url;
  pageStatusElement.dataset.state = pageState;
  pageStatusDotElement.className = `status-dot status-dot-${pageState === "ready" ? "connected" : pageState === "checking" ? "checking" : "error"}`;
  pageStatusLabelElement.textContent = pageLabel;
  pageStatusMetaElement.textContent = pageMeta;
  pageStatusMetaElement.classList.toggle("is-hidden", !pageMeta);
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

liveCaptureSourceElements.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      void KumaPickerExtensionLiveCaptureSettings.writeSource(input.value);
    }
    syncButtonState();
  });
});

daemonUrlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    connectDaemonButton.click();
  } else if (event.key === "Escape") {
    event.preventDefault();
    setConnectionEditMode(false, { resetValue: true });
  }
});

updateConnectionEditUi();
