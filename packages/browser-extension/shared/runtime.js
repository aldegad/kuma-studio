const AgentPickerExtensionShared = (() => {
  const DEFAULT_DAEMON_URL = "http://127.0.0.1:4312";
  const DAEMON_STORAGE_KEY = "agentPicker.browserExtension.daemonUrl";
  const INSPECT_KEY_PREFIX = "agentPicker.browserExtension.inspect.";

  function normalizeDaemonUrl(rawValue) {
    const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
    return (trimmed || DEFAULT_DAEMON_URL).replace(/\/+$/, "");
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
    DEFAULT_DAEMON_URL,
    INSPECT_KEY_PREFIX,
    createDaemonSocketUrl,
    createSessionId,
    normalizeDaemonUrl,
  };
})();
