const {
  DAEMON_STORAGE_KEY,
  normalizeDaemonUrl,
} = AgentPickerExtensionShared;

async function readDaemonUrl() {
  const stored = await chrome.storage.local.get(DAEMON_STORAGE_KEY);
  return normalizeDaemonUrl(stored[DAEMON_STORAGE_KEY]);
}

async function writeDaemonUrl(value) {
  const daemonUrl = normalizeDaemonUrl(value);
  await chrome.storage.local.set({ [DAEMON_STORAGE_KEY]: daemonUrl });
  return daemonUrl;
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.id === "number" ? { tabId: tab.id } : { tabId: null };
}
