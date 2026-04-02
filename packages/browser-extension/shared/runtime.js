const KumaPickerExtensionShared = (() => {
  const DEFAULT_PORT = 4312;
  const DEFAULT_DAEMON_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
  const DAEMON_STORAGE_KEY = "kumaPicker.browserExtension.daemonUrl";
  const INSPECT_KEY_PREFIX = "kumaPicker.browserExtension.inspect.";
  const LIVE_CAPTURE_SETTINGS_STORAGE_KEY = "kumaPicker.browserExtension.liveCaptureSettings";

  function normalizeDaemonUrl(rawValue) {
    const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
    return (trimmed || DEFAULT_DAEMON_URL).replace(/\/+$/, "");
  }

  async function readDaemonUrl() {
    if (typeof chrome === "undefined" || !chrome.storage?.local?.get) {
      return DEFAULT_DAEMON_URL;
    }

    const stored = await chrome.storage.local.get(DAEMON_STORAGE_KEY);
    return normalizeDaemonUrl(stored[DAEMON_STORAGE_KEY]);
  }

  function createDaemonSocketUrl(rawValue) {
    const endpoint = new URL(`${normalizeDaemonUrl(rawValue)}/browser-session/socket`);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    return endpoint.toString();
  }

  function createSessionId() {
    if (typeof crypto?.randomUUID === "function") {
      return `browser-${crypto.randomUUID()}`;
    }

    return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  return {
    DAEMON_STORAGE_KEY,
    DEFAULT_PORT,
    DEFAULT_DAEMON_URL,
    INSPECT_KEY_PREFIX,
    LIVE_CAPTURE_SETTINGS_STORAGE_KEY,
    createDaemonSocketUrl,
    createSessionId,
    readDaemonUrl,
    normalizeDaemonUrl,
  };
})();
