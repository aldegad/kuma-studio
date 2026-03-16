const INTERACTIVE_SCRIPT_FILES = ["content/interactive.js"];

async function ensureInteractiveAgentPicker(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: INTERACTIVE_SCRIPT_FILES,
    });
  } catch {
    throw new Error(
      "This page does not allow the Agent Picker interactive tools. Try a regular website tab instead of a browser-internal page.",
    );
  }
}
