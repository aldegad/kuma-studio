const INTERACTIVE_SCRIPT_FILES = ["content/interactive.js"];

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
