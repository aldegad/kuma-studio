export function normalizeDaemonUrl(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  return (trimmed || "http://127.0.0.1:4312").replace(/\/+$/, "");
}

export function createBrowserSessionSocketUrl(daemonUrl) {
  const endpoint = new URL(`${normalizeDaemonUrl(daemonUrl)}/browser-session/socket`);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  return endpoint.toString();
}

export function getBrowserTransportModeFromEnv() {
  return process.env.AGENT_PICKER_TRANSPORT === "legacy-poll" ? "legacy-poll" : "websocket";
}

export async function resolveBrowserTransportMode(daemonUrl) {
  const forcedMode = getBrowserTransportModeFromEnv();
  if (forcedMode === "legacy-poll") {
    return forcedMode;
  }

  try {
    const response = await fetch(`${normalizeDaemonUrl(daemonUrl)}/health`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return "legacy-poll";
    }

    const payload = await response.json();
    return payload?.browserTransport === "websocket" ? "websocket" : "legacy-poll";
  } catch {
    return "legacy-poll";
  }
}
