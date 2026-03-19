import { getKumaPickerDaemonUrl } from "../scene-daemon";

export type KumaPickerAgentNoteStatus = "acknowledged" | "in_progress" | "fixed" | "needs_reselect";
export const DEFAULT_KUMA_PICKER_NOTE_SESSION_ID = "global-note";

export interface KumaPickerAgentNoteRecord {
  version: 1;
  sessionId: string;
  selectionId?: string | null;
  author: string;
  status: KumaPickerAgentNoteStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface KumaPickerAgentNotePayload {
  sessionId?: string;
  selectionId?: string | null;
  author: string;
  status: KumaPickerAgentNoteStatus;
  message: string;
}

export interface KumaPickerAgentNoteEvent {
  type: "agent-note.updated";
  source: string;
  sessionId: string;
  deleted: boolean;
  updatedAt?: string;
  note: KumaPickerAgentNoteRecord | null;
}

export function getKumaPickerAgentNoteEndpoint(sessionId?: string): string {
  const endpoint = new URL(`${getKumaPickerDaemonUrl()}/agent-note`);
  if (sessionId) {
    endpoint.searchParams.set("sessionId", sessionId);
  }

  return endpoint.toString();
}

export async function fetchKumaPickerAgentNote(sessionId?: string) {
  const response = await fetch(getKumaPickerAgentNoteEndpoint(sessionId), {
    cache: "no-store",
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to load agent note");
  }

  return (await response.json()) as KumaPickerAgentNoteRecord;
}

export function getKumaPickerAgentNoteStatusLabel(status: KumaPickerAgentNoteStatus) {
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

export function parseKumaPickerAgentNoteEvent(raw: string): KumaPickerAgentNoteEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type !== "agent-note.updated" || typeof parsed.sessionId !== "string") {
      return null;
    }

    const rawNote = parsed.note;
    const note =
      rawNote && typeof rawNote === "object"
        ? (rawNote as KumaPickerAgentNoteRecord)
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
