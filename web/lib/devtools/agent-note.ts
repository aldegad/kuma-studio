import { getAgentPickerDaemonUrl } from "../scene-daemon";

export type AgentPickerAgentNoteStatus = "acknowledged" | "in_progress" | "fixed" | "needs_reselect";
export const DEFAULT_AGENT_PICKER_NOTE_SESSION_ID = "global-note";

export interface AgentPickerAgentNoteRecord {
  version: 1;
  sessionId: string;
  selectionId?: string | null;
  author: string;
  status: AgentPickerAgentNoteStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPickerAgentNotePayload {
  sessionId?: string;
  selectionId?: string | null;
  author: string;
  status: AgentPickerAgentNoteStatus;
  message: string;
}

export interface AgentPickerAgentNoteEvent {
  type: "agent-note.updated";
  source: string;
  sessionId: string;
  deleted: boolean;
  updatedAt?: string;
  note: AgentPickerAgentNoteRecord | null;
}

export function getAgentPickerAgentNoteEndpoint(sessionId?: string): string {
  const endpoint = new URL(`${getAgentPickerDaemonUrl()}/agent-note`);
  if (sessionId) {
    endpoint.searchParams.set("sessionId", sessionId);
  }

  return endpoint.toString();
}

export async function fetchAgentPickerAgentNote(sessionId?: string) {
  const response = await fetch(getAgentPickerAgentNoteEndpoint(sessionId), {
    cache: "no-store",
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to load agent note");
  }

  return (await response.json()) as AgentPickerAgentNoteRecord;
}

export function getAgentPickerAgentNoteStatusLabel(status: AgentPickerAgentNoteStatus) {
  switch (status) {
    case "acknowledged":
      return "Read";
    case "in_progress":
      return "Working";
    case "fixed":
      return "Fixed";
    case "needs_reselect":
      return "Need Reselect";
    default:
      return "Updated";
  }
}

export function parseAgentPickerAgentNoteEvent(raw: string): AgentPickerAgentNoteEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type !== "agent-note.updated" || typeof parsed.sessionId !== "string") {
      return null;
    }

    const rawNote = parsed.note;
    const note =
      rawNote && typeof rawNote === "object"
        ? (rawNote as AgentPickerAgentNoteRecord)
        : null;

    return {
      type: "agent-note.updated",
      source: typeof parsed.source === "string" ? parsed.source : "unknown",
      sessionId: parsed.sessionId,
      deleted: Boolean(parsed.deleted),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      note,
    };
  } catch {
    return null;
  }
}
