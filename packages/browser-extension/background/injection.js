const INTERACTIVE_SCRIPT_FILES = ["content/interactive.js"];
const AUTOMATION_SCRIPT_FILES = [
  "content/runtime-observer.js",
  "content/constants.js",
  "content/page-context.js",
  "content/job-cards.js",
  "content/agent-actions-core.js",
  "content/agent-actions-gesture-overlay.js",
  "content/agent-actions-interaction.js",
  "content/playwright-runtime.js",
  "content/bridge.js",
];
const RUNTIME_OBSERVER_MAIN_SCRIPT_FILES = ["content/runtime-observer-main.js"];

async function executeKumaPickerScripts(tabId, files, unavailableMessage) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    });
  } catch {
    throw new Error(unavailableMessage);
  }
}

async function ensureInteractiveKumaPicker(tabId) {
  await executeKumaPickerScripts(
    tabId,
    INTERACTIVE_SCRIPT_FILES,
    "This page does not allow the Kuma Picker interactive tools. Try a regular website tab instead of a browser-internal page.",
  );
}

async function ensureAutomationBridge(tabId) {
  await executeKumaPickerScripts(
    tabId,
    AUTOMATION_SCRIPT_FILES,
    "This page does not allow the Kuma Picker automation runtime. Try a regular website tab instead of a browser-internal page.",
  );
}

async function ensureRuntimeObserver(tabId, frameId = 0) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: RUNTIME_OBSERVER_MAIN_SCRIPT_FILES,
      world: "MAIN",
    });
  } catch {
    throw new Error("This page does not allow the Kuma Picker runtime observer. Try a regular website tab instead of a browser-internal page.");
  }
}
