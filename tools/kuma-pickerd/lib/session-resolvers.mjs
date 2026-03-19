import { DEFAULT_AGENT_NOTE_SESSION_ID } from "./agent-note-store.mjs";
import { DevSelectionStore } from "./dev-selection-store.mjs";

export function resolveAgentNoteSessionId(root, sessionId, allowGlobalFallback = false) {
  const explicitSessionId =
    typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const selectionStore = new DevSelectionStore(root);
  return selectionStore.readAll()?.latestSessionId ?? (allowGlobalFallback ? DEFAULT_AGENT_NOTE_SESSION_ID : null);
}
