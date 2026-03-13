const DEFAULT_DAEMON_URL = "http://127.0.0.1:4312";
const STORAGE_KEY = "agentPicker.browserExtension.daemonUrl";

const daemonUrlInput = document.getElementById("daemon-url");
const testBridgeButton = document.getElementById("test-bridge");
const capturePageButton = document.getElementById("capture-page");
const inspectElementButton = document.getElementById("inspect-element");
const statusElement = document.getElementById("status");
const lastSavedElement = document.getElementById("last-saved");

function normalizeDaemonUrl(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  return (trimmed || DEFAULT_DAEMON_URL).replace(/\/+$/, "");
}

async function readDaemonUrl() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeDaemonUrl(stored[STORAGE_KEY]);
}

async function writeDaemonUrl(value) {
  const daemonUrl = normalizeDaemonUrl(value);
  await chrome.storage.local.set({ [STORAGE_KEY]: daemonUrl });
  return daemonUrl;
}

async function readActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const [tab] = tabs;
  return tab && typeof tab.id === "number"
    ? {
        tabId: tab.id,
        windowId: typeof tab.windowId === "number" ? tab.windowId : null,
      }
    : {
        tabId: null,
        windowId: null,
      };
}

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

async function sendMessage(type) {
  const daemonUrl = await writeDaemonUrl(daemonUrlInput.value);
  const target = await readActiveTab();
  return chrome.runtime.sendMessage({ type, daemonUrl, ...target });
}

async function handleAction(type, workingMessage, successMessage) {
  setBusyState(true);
  setStatus(workingMessage, "working");

  try {
    const result = await sendMessage(type);
    if (!result?.ok) {
      throw new Error(result?.error || "The bridge did not return a result.");
    }

    setStatus(result.message || successMessage, "success");
    if (result.selection?.page?.title) {
      setLastSaved(`Latest selection: ${result.selection.page.title}`);
    } else if (result.selection?.page?.url) {
      setLastSaved(`Latest selection: ${result.selection.page.url}`);
    } else {
      setLastSaved("");
    }
    return true;
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : String(error),
      "error",
    );
    return false;
  } finally {
    setBusyState(false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const daemonUrl = await readDaemonUrl();
  daemonUrlInput.value = daemonUrl;
  setStatus("Idle.", "idle");
});

testBridgeButton.addEventListener("click", async () => {
  await handleAction(
    "agent-picker:test-daemon",
    "Checking the local bridge...",
    "Bridge reachable.",
  );
});

capturePageButton.addEventListener("click", async () => {
  await handleAction(
    "agent-picker:capture-page",
    "Capturing the current page...",
    "Current page saved to the daemon.",
  );
});

inspectElementButton.addEventListener("click", async () => {
  const ok = await handleAction(
    "agent-picker:start-inspect",
    "Inspect mode armed. Click the page element you want to save.",
    "Inspect mode armed. Click the target element in the page.",
  );
  if (ok) {
    window.close();
  }
});
