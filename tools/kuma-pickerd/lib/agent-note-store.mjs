import { mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { resolveKumaPickerStateDir } from "./state-home.mjs";

const VALID_STATUSES = new Set(["acknowledged", "in_progress", "fixed", "needs_reselect"]);
export const DEFAULT_AGENT_NOTE_SESSION_ID = "global-note";

function sanitizeSessionId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return /^[a-zA-Z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
}

function sanitizeSelectionId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 240) : null;
}

function sanitizeAuthor(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 48) : null;
}

function sanitizeMessage(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 600) : null;
}

function normalizeStatus(value, fallback = "acknowledged") {
  return typeof value === "string" && VALID_STATUSES.has(value) ? value : fallback;
}

function normalizeAgentNote(note, defaults = {}) {
  const candidate = note && typeof note === "object" ? note : {};
  const sessionId = sanitizeSessionId(candidate.sessionId) ?? sanitizeSessionId(defaults.sessionId);
  if (!sessionId) {
    throw new Error("Missing required field: sessionId");
  }

  const author = sanitizeAuthor(candidate.author) ?? sanitizeAuthor(defaults.author) ?? "agent";
  const message = sanitizeMessage(candidate.message) ?? sanitizeMessage(defaults.message);
  if (!message) {
    throw new Error("Missing required field: message");
  }

  const createdAt =
    typeof defaults.createdAt === "string" && defaults.createdAt.trim()
      ? defaults.createdAt
      : typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : new Date().toISOString();
  const updatedAt =
    typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt : new Date().toISOString();

  return {
    version: 1,
    sessionId,
    selectionId: sanitizeSelectionId(candidate.selectionId) ?? sanitizeSelectionId(defaults.selectionId),
    author,
    status: normalizeStatus(candidate.status, normalizeStatus(defaults.status)),
    message,
    createdAt,
    updatedAt,
  };
}

export class AgentNoteStore {
  constructor(root) {
    this.root = resolve(root);
    this.notesDir = resolve(resolveKumaPickerStateDir(), "agent-notes");
  }

  ensureDirectory() {
    mkdirSync(dirname(this.notesDir), { recursive: true });
    mkdirSync(this.notesDir, { recursive: true });
  }

  getSessionPath(sessionId) {
    return resolve(this.notesDir, `${sessionId}.json`);
  }

  readSession(sessionId) {
    const normalizedId = sanitizeSessionId(sessionId);
    if (!normalizedId) {
      return null;
    }

    try {
      return normalizeAgentNote(JSON.parse(readFileSync(this.getSessionPath(normalizedId), "utf8")), {
        sessionId: normalizedId,
      });
    } catch {
      return null;
    }
  }

  write(note, defaults = {}) {
    this.ensureDirectory();
    const sessionId = sanitizeSessionId(note?.sessionId) ?? sanitizeSessionId(defaults.sessionId);
    if (!sessionId) {
      throw new Error("Missing required field: sessionId");
    }

    const existing = this.readSession(sessionId);
    const normalized = normalizeAgentNote(note, {
      sessionId,
      selectionId: existing?.selectionId ?? defaults.selectionId,
      author: existing?.author ?? defaults.author,
      status: existing?.status ?? defaults.status,
      message: existing?.message ?? defaults.message,
      createdAt: existing?.createdAt,
    });

    writeFileSync(this.getSessionPath(sessionId), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }

  deleteSession(sessionId) {
    const normalizedId = sanitizeSessionId(sessionId);
    if (!normalizedId) {
      return null;
    }

    const existing = this.readSession(normalizedId);
    rmSync(this.getSessionPath(normalizedId), { force: true });
    return existing;
  }
}

function toSessionId(filename) {
  if (typeof filename !== "string" || !filename.endsWith(".json")) {
    return null;
  }

  const sessionId = basename(filename, ".json");
  return sanitizeSessionId(sessionId);
}

export function watchAgentNotes(agentNoteStore, onNoteChange) {
  agentNoteStore.ensureDirectory();

  const watcher = watch(agentNoteStore.notesDir, (eventType, filename) => {
    if (eventType !== "change" && eventType !== "rename") {
      return;
    }

    const sessionId = toSessionId(filename);
    if (!sessionId) {
      return;
    }

    try {
      const note = agentNoteStore.readSession(sessionId);
      onNoteChange(note ?? { sessionId }, note ? "file-watch" : "file-watch-delete", !note);
    } catch {
      // Ignore temporary partial writes while the file is still being updated.
    }
  });

  return () => {
    watcher.close();
  };
}
