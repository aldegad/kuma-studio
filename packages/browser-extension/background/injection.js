const INTERACTIVE_SCRIPT_FILES = ["content/interactive.js"];
const RUNTIME_OBSERVER_MAIN_SCRIPT_FILES = ["content/runtime-observer-main.js"];

async function executeAgentPickerScripts(tabId, files, unavailableMessage) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    });
  } catch {
    throw new Error(unavailableMessage);
  }
}

async function ensureInteractiveAgentPicker(tabId) {
  await executeAgentPickerScripts(
    tabId,
    INTERACTIVE_SCRIPT_FILES,
    "This page does not allow the Agent Picker interactive tools. Try a regular website tab instead of a browser-internal page.",
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
    throw new Error("This page does not allow the Agent Picker runtime observer. Try a regular website tab instead of a browser-internal page.");
  }
}
