/** WebSocket client utilities for kuma-studio server communication */

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;

export function createStudioWsUrl(host = window.location.hostname, port = KUMA_PORT): string {
  return `ws://${host}:${port}`;
}

export function isStudioEvent(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    (data as Record<string, unknown>).type === "kuma-studio:event"
  );
}
