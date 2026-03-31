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
const interactiveInjectionCache = new Map();
const automationInjectionCache = new Map();

async function readTabCacheKey(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = typeof tab?.url === "string" ? tab.url : null;
  if (!url) {
    throw new Error("The target tab does not have a usable URL.");
  }

  return `${tabId}:${url}`;
}

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

async function ensureInjectedScripts(tabId, files, unavailableMessage, cache) {
  const cacheKey = await readTabCacheKey(tabId);
  if (cache.get(tabId) === cacheKey) {
    return;
  }

  await executeKumaPickerScripts(tabId, files, unavailableMessage);
  cache.set(tabId, cacheKey);
}

function clearInjectedScriptsCache(tabId, cache) {
  if (Number.isInteger(tabId)) {
    cache.delete(tabId);
    return;
  }

  cache.clear();
}

async function ensureInteractiveKumaPicker(tabId) {
  await ensureInjectedScripts(
    tabId,
    INTERACTIVE_SCRIPT_FILES,
    "This page does not allow the Kuma Picker interactive tools. Try a regular website tab instead of a browser-internal page.",
    interactiveInjectionCache,
  );
}

async function ensureAutomationBridge(tabId) {
  await ensureInjectedScripts(
    tabId,
    AUTOMATION_SCRIPT_FILES,
    "This page does not allow the Kuma Picker automation runtime. Try a regular website tab instead of a browser-internal page.",
    automationInjectionCache,
  );
}

function invalidateInteractiveKumaPicker(tabId = null) {
  clearInjectedScriptsCache(tabId, interactiveInjectionCache);
}

function invalidateAutomationBridge(tabId = null) {
  clearInjectedScriptsCache(tabId, automationInjectionCache);
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
