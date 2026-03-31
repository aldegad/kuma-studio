/** WebSocket client utilities for kuma-studio server communication */

export function createStudioWsUrl(host = window.location.hostname, port = 4312): string {
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
