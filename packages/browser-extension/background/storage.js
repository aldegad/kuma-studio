const {
  DAEMON_STORAGE_KEY,
  INSPECT_KEY_PREFIX,
  normalizeDaemonUrl,
} = KumaPickerExtensionShared;

async function getStoredDaemonUrl() {
  const stored = await chrome.storage.local.get(DAEMON_STORAGE_KEY);
  return normalizeDaemonUrl(stored[DAEMON_STORAGE_KEY]);
}

async function setStoredDaemonUrl(rawValue) {
  const daemonUrl = normalizeDaemonUrl(rawValue);
  await chrome.storage.local.set({ [DAEMON_STORAGE_KEY]: daemonUrl });
  return daemonUrl;
}

async function setInspectState(tabId, daemonUrl) {
  await chrome.storage.local.set({
    [`${INSPECT_KEY_PREFIX}${tabId}`]: {
      daemonUrl,
      armedAt: new Date().toISOString(),
    },
  });
}

async function getInspectState(tabId) {
  const key = `${INSPECT_KEY_PREFIX}${tabId}`;
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? null;
}

async function clearInspectState(tabId) {
  await chrome.storage.local.remove(`${INSPECT_KEY_PREFIX}${tabId}`);

  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch {
    // Ignore badge cleanup errors after the tab has already gone away.
  }
}
