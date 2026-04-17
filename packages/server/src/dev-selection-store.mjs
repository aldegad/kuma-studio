import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  extensionForMimeType,
  mimeTypeForFileName,
  normalizeDevSelection,
  parseSnapshotPayload,
  sanitizeAssetFileName,
  sanitizeSessionId,
} from "./dev-selection-normalize.mjs";
import { resolveKumaPickerStateDir } from "./state-home.mjs";

export class DevSelectionStore {
  constructor(root) {
    this.root = resolve(root);
    this.stateDir = resolveKumaPickerStateDir();
    this.selectionPath = resolve(this.stateDir, "dev-selection.json");
    this.selectionDir = resolve(this.stateDir, "dev-selections");
    this.collectionPath = resolve(this.stateDir, "dev-selections.json");
    this.assetDir = resolve(this.stateDir, "dev-selection-assets");
  }

  ensureDirectory() {
    mkdirSync(dirname(this.selectionPath), { recursive: true });
    mkdirSync(this.selectionDir, { recursive: true });
    mkdirSync(this.assetDir, { recursive: true });
  }

  getSessionPath(sessionId) {
    return resolve(this.selectionDir, `${sessionId}.json`);
  }

  getSessionAssetDir(sessionId) {
    return resolve(this.assetDir, sessionId);
  }

  getAssetPath(sessionId, fileName) {
    return resolve(this.getSessionAssetDir(sessionId), fileName);
  }

  readAsset(sessionId, fileName) {
    const normalizedId = sanitizeSessionId(sessionId);
    const normalizedFileName = sanitizeAssetFileName(fileName);
    if (!normalizedId || !normalizedFileName) {
      return null;
    }

    const assetPath = this.getAssetPath(normalizedId, normalizedFileName);
    if (!existsSync(assetPath)) {
      return null;
    }

    return {
      body: readFileSync(assetPath),
      mimeType: mimeTypeForFileName(normalizedFileName),
    };
  }

  readSession(sessionId) {
    const normalizedId = sanitizeSessionId(sessionId);
    if (!normalizedId) {
      return null;
    }

    try {
      return normalizeDevSelection(JSON.parse(readFileSync(this.getSessionPath(normalizedId), "utf8")), {
        id: normalizedId,
        projectRoot: this.root,
      });
    } catch {
      return null;
    }
  }

  read() {
    try {
      return normalizeDevSelection(JSON.parse(readFileSync(this.selectionPath, "utf8")), {
        projectRoot: this.root,
      });
    } catch {
      return null;
    }
  }

  readAll() {
    this.ensureDirectory();

    const sessions = readdirSync(this.selectionDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => {
        const sessionId = fileName.slice(0, -5);
        return this.readSession(sessionId);
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.session.index !== right.session.index) {
          return left.session.index - right.session.index;
        }

        return left.capturedAt.localeCompare(right.capturedAt);
      });

    if (sessions.length === 0) {
      const latest = this.read();
      if (!latest) {
        return null;
      }

      sessions.push(latest);
    }

    let latestSessionId = null;
    if (existsSync(this.collectionPath)) {
      try {
        const collection = JSON.parse(readFileSync(this.collectionPath, "utf8"));
        latestSessionId = sanitizeSessionId(collection.latestSessionId);
      } catch {
        latestSessionId = null;
      }
    }

    if (!latestSessionId || !sessions.some((record) => record.session.id === latestSessionId)) {
      latestSessionId = sessions[sessions.length - 1]?.session.id ?? null;
    }

    return {
      version: 1,
      updatedAt: sessions[sessions.length - 1]?.capturedAt ?? new Date().toISOString(),
      latestSessionId,
      sessions,
    };
  }

  clearAll() {
    rmSync(this.selectionDir, { recursive: true, force: true });
    rmSync(this.assetDir, { recursive: true, force: true });
    rmSync(this.collectionPath, { force: true });
    rmSync(this.selectionPath, { force: true });
    this.ensureDirectory();
  }

  deleteSession(sessionId) {
    const normalizedId = sanitizeSessionId(sessionId);
    if (!normalizedId) {
      return this.readAll();
    }

    rmSync(this.getSessionPath(normalizedId), { force: true });
    rmSync(this.getSessionAssetDir(normalizedId), { recursive: true, force: true });

    const collection = this.readAll();
    if (!collection) {
      rmSync(this.collectionPath, { force: true });
      rmSync(this.selectionPath, { force: true });
      return null;
    }

    const nextSessions = collection.sessions.filter((entry) => entry.session.id !== normalizedId);
    if (nextSessions.length === 0) {
      rmSync(this.collectionPath, { force: true });
      rmSync(this.selectionPath, { force: true });
      rmSync(this.selectionDir, { recursive: true, force: true });
      rmSync(this.assetDir, { recursive: true, force: true });
      this.ensureDirectory();
      return null;
    }

    const nextCollection = {
      version: 1,
      updatedAt: new Date().toISOString(),
      latestSessionId:
        collection.latestSessionId === normalizedId
          ? nextSessions[nextSessions.length - 1].session.id
          : collection.latestSessionId,
      sessions: nextSessions,
    };

    writeFileSync(this.collectionPath, `${JSON.stringify(nextCollection, null, 2)}\n`, "utf8");
    writeFileSync(
      this.selectionPath,
      `${JSON.stringify(nextSessions[nextSessions.length - 1], null, 2)}\n`,
      "utf8",
    );

    return nextCollection;
  }

  updateSession(sessionId, updater) {
    const normalizedId = sanitizeSessionId(sessionId);
    if (!normalizedId || typeof updater !== "function") {
      return null;
    }

    this.ensureDirectory();
    const current = this.readSession(normalizedId);
    if (!current) {
      return null;
    }

    const nextRecord = updater(current);
    if (!nextRecord || typeof nextRecord !== "object") {
      return null;
    }

    const normalized = normalizeDevSelection(nextRecord, {
      id: current.session.id,
      index: current.session.index,
      label: current.session.label,
      updatedAt: current.session.updatedAt,
      projectRoot: current.projectRoot ?? this.root,
    });

    writeFileSync(this.getSessionPath(normalizedId), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

    const collection = this.readAll();
    if (!collection) {
      writeFileSync(this.selectionPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      return normalized;
    }

    const nextSessions = collection.sessions.map((entry) => (entry.session.id === normalizedId ? normalized : entry));
    const nextLatestSessionId =
      collection.latestSessionId && nextSessions.some((entry) => entry.session.id === collection.latestSessionId)
        ? collection.latestSessionId
        : normalizedId;
    const latestRecord =
      nextSessions.find((entry) => entry.session.id === nextLatestSessionId) ??
      nextSessions[nextSessions.length - 1] ??
      normalized;
    const nextCollection = {
      version: 1,
      updatedAt: new Date().toISOString(),
      latestSessionId: latestRecord.session.id,
      sessions: nextSessions,
    };

    writeFileSync(this.collectionPath, `${JSON.stringify(nextCollection, null, 2)}\n`, "utf8");
    if (latestRecord.session.id === normalizedId) {
      writeFileSync(this.selectionPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    } else {
      writeFileSync(this.selectionPath, `${JSON.stringify(latestRecord, null, 2)}\n`, "utf8");
    }

    return normalized;
  }

  syncJobForSession(sessionId, jobCard = null) {
    return this.updateSession(sessionId, (current) => ({
      ...current,
      session: {
        ...current.session,
        updatedAt: new Date().toISOString(),
      },
      job:
        jobCard && typeof jobCard === "object"
          ? {
              id:
                typeof jobCard.id === "string" && jobCard.id.trim()
                  ? jobCard.id.trim()
                  : current.job?.id ?? current.session.id,
              message:
                typeof jobCard.requestMessage === "string" && jobCard.requestMessage.trim()
                  ? jobCard.requestMessage.trim()
                  : current.job?.message ?? "",
              createdAt:
                typeof current.job?.createdAt === "string" && current.job.createdAt.trim()
                  ? current.job.createdAt
                  : typeof jobCard.createdAt === "string" && jobCard.createdAt.trim()
                    ? jobCard.createdAt
                    : current.capturedAt,
              author:
                typeof jobCard.author === "string" && jobCard.author.trim()
                  ? jobCard.author.trim()
                  : current.job?.author ?? "user",
              status:
                jobCard.status === "in_progress" || jobCard.status === "completed"
                  ? jobCard.status
                  : "noted",
            }
          : null,
    }));
  }

  write(record) {
    this.ensureDirectory();
    const collection = this.readAll();
    const existingSession = record?.session?.id
      ? collection?.sessions.find((entry) => entry.session.id === record.session.id)?.session
      : null;
    const nextIndex =
      existingSession?.index ??
      Math.max(0, ...(collection?.sessions.map((entry) => entry.session.index) ?? [])) + 1;
    const normalized = normalizeDevSelection(record, {
      id: record?.session?.id,
      index: nextIndex,
      label: existingSession?.label ?? `Session ${nextIndex}`,
      projectRoot: record?.projectRoot ?? this.root,
    });
    const persisted = this.persistSnapshots(normalized, record);
    persisted.session.updatedAt = persisted.capturedAt;

    const nextSessions = [
      ...(collection?.sessions.filter((entry) => entry.session.id !== persisted.session.id) ?? []),
      persisted,
    ].sort((left, right) => {
      if (left.session.index !== right.session.index) {
        return left.session.index - right.session.index;
      }

      return left.capturedAt.localeCompare(right.capturedAt);
    });

    const nextCollection = {
      version: 1,
      updatedAt: persisted.capturedAt,
      latestSessionId: persisted.session.id,
      sessions: nextSessions,
    };

    writeFileSync(
      this.getSessionPath(persisted.session.id),
      `${JSON.stringify(persisted, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(this.collectionPath, `${JSON.stringify(nextCollection, null, 2)}\n`, "utf8");
    writeFileSync(this.selectionPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
    return persisted;
  }

  persistSnapshots(normalized, rawRecord) {
    const sessionId = normalized.session.id;
    rmSync(this.getSessionAssetDir(sessionId), { recursive: true, force: true });

    const rawElements = Array.isArray(rawRecord?.elements) ? rawRecord.elements : [];
    const nextElements = normalized.elements.map((element, index) => {
      const rawElement =
        rawElements[index] ??
        (index === normalized.elements.length - 1 && rawRecord?.element && typeof rawRecord.element === "object"
          ? rawRecord.element
          : null);
      const snapshot = this.writeSnapshot(rawElement?.snapshot, sessionId, index);

      return snapshot
        ? {
            ...element,
            snapshot,
          }
        : element;
    });

    return {
      ...normalized,
      element: nextElements[nextElements.length - 1],
      elements: nextElements,
    };
  }

  writeSnapshot(snapshot, sessionId, index) {
    const payload = parseSnapshotPayload(snapshot);
    if (!payload) {
      return null;
    }

    const extension = extensionForMimeType(payload.mimeType);
    const fileName = `selection-${String(index + 1).padStart(2, "0")}.${extension}`;
    mkdirSync(this.getSessionAssetDir(sessionId), { recursive: true });
    writeFileSync(this.getAssetPath(sessionId, fileName), payload.data);

    return {
      assetUrl: `/dev-selection/assets/${sessionId}/${fileName}`,
      mimeType: payload.mimeType,
      width: payload.width,
      height: payload.height,
      capturedAt: payload.capturedAt,
    };
  }
}
