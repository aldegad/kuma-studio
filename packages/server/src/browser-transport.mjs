import { DEFAULT_PORT } from "./constants.mjs";

export function normalizeDaemonUrl(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  return (trimmed || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/+$/, "");
}

export function createBrowserSessionSocketUrl(daemonUrl) {
  const endpoint = new URL(`${normalizeDaemonUrl(daemonUrl)}/browser-session/socket`);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  return endpoint.toString();
}
