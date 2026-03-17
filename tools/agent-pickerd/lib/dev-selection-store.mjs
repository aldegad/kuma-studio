import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveAgentPickerStateDir } from "./state-home.mjs";

function normalizeRect(rect) {
  const candidate = rect && typeof rect === "object" ? rect : {};

  return {
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0,
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
  };
}

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

function sanitizeAssetFileName(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,128}$/.test(trimmed) ? trimmed : null;
}

function normalizeSnapshot(snapshot) {
  const candidate = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!candidate) {
    return null;
  }

  const assetUrl = typeof candidate.assetUrl === "string" ? candidate.assetUrl.trim() : "";
  if (!/^\/dev-selection\/assets\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,128}$/.test(assetUrl)) {
    return null;
  }

  return {
    assetUrl,
    mimeType:
      typeof candidate.mimeType === "string" && candidate.mimeType.startsWith("image/")
        ? candidate.mimeType
        : "image/png",
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
    capturedAt:
      typeof candidate.capturedAt === "string" && candidate.capturedAt.trim()
        ? candidate.capturedAt
        : new Date().toISOString(),
  };
}

function parseSnapshotPayload(snapshot) {
  const candidate = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!candidate || typeof candidate.dataUrl !== "string") {
    return null;
  }

  const match = candidate.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType:
      typeof candidate.mimeType === "string" && candidate.mimeType.startsWith("image/")
        ? candidate.mimeType
        : match[1],
    data: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
    capturedAt:
      typeof candidate.capturedAt === "string" && candidate.capturedAt.trim()
        ? candidate.capturedAt
        : new Date().toISOString(),
  };
}

function extensionForMimeType(mimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function mimeTypeForFileName(fileName) {
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (fileName.endsWith(".webp")) {
    return "image/webp";
  }

  if (fileName.endsWith(".gif")) {
    return "image/gif";
  }

  return "image/png";
}

function normalizeEdges(edges) {
  const candidate = edges && typeof edges === "object" ? edges : {};

  return {
    top: typeof candidate.top === "number" && Number.isFinite(candidate.top) ? candidate.top : 0,
    right: typeof candidate.right === "number" && Number.isFinite(candidate.right) ? candidate.right : 0,
    bottom: typeof candidate.bottom === "number" && Number.isFinite(candidate.bottom) ? candidate.bottom : 0,
    left: typeof candidate.left === "number" && Number.isFinite(candidate.left) ? candidate.left : 0,
  };
}

function normalizeElement(element) {
  const candidate = element && typeof element === "object" ? element : {};
  const classNames = Array.isArray(candidate.classNames) ? candidate.classNames.filter((value) => typeof value === "string") : [];
  const datasetEntries = candidate.dataset && typeof candidate.dataset === "object" ? Object.entries(candidate.dataset) : [];
  const dataset = Object.fromEntries(datasetEntries.filter(([key, value]) => typeof key === "string" && typeof value === "string"));
  const rawBoxModel = candidate.boxModel && typeof candidate.boxModel === "object" ? candidate.boxModel : {};
  const rawTypography = candidate.typography && typeof candidate.typography === "object" ? candidate.typography : null;
  const snapshot = normalizeSnapshot(candidate.snapshot);
  const typography =
    rawTypography &&
    typeof rawTypography.fontSize === "string" &&
    typeof rawTypography.fontFamily === "string" &&
    typeof rawTypography.fontWeight === "string"
      ? {
          fontSize: rawTypography.fontSize,
          fontFamily: rawTypography.fontFamily,
          fontWeight: rawTypography.fontWeight,
        }
      : null;

  return {
    tagName: typeof candidate.tagName === "string" ? candidate.tagName : "div",
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : null,
    classNames,
    role: typeof candidate.role === "string" && candidate.role.trim() ? candidate.role : null,
    label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : null,
    textPreview: typeof candidate.textPreview === "string" ? candidate.textPreview : "",
    value: typeof candidate.value === "string" ? candidate.value : null,
    valuePreview: typeof candidate.valuePreview === "string" ? candidate.valuePreview : null,
    checked: typeof candidate.checked === "boolean" ? candidate.checked : null,
    selectedValue: typeof candidate.selectedValue === "string" ? candidate.selectedValue : null,
    selectedValues: Array.isArray(candidate.selectedValues)
      ? candidate.selectedValues.filter((value) => typeof value === "string")
      : [],
    placeholder: typeof candidate.placeholder === "string" ? candidate.placeholder : null,
    required: candidate.required === true,
    disabled: candidate.disabled === true,
    readOnly: candidate.readOnly === true,
    multiple: candidate.multiple === true,
    inputType: typeof candidate.inputType === "string" && candidate.inputType.trim() ? candidate.inputType.trim() : null,
    selector: typeof candidate.selector === "string" ? candidate.selector : "",
    selectorPath: typeof candidate.selectorPath === "string" ? candidate.selectorPath : "",
    dataset,
    rect: normalizeRect(candidate.rect),
    boxModel: {
      margin: normalizeEdges(rawBoxModel.margin),
      padding: normalizeEdges(rawBoxModel.padding),
      border: normalizeEdges(rawBoxModel.border),
      marginRect: normalizeRect(rawBoxModel.marginRect),
      paddingRect: normalizeRect(rawBoxModel.paddingRect),
      contentRect: normalizeRect(rawBoxModel.contentRect),
    },
    typography,
    snapshot,
    outerHTMLSnippet: typeof candidate.outerHTMLSnippet === "string" ? candidate.outerHTMLSnippet : "",
  };
}

function normalizeSession(session, defaults = {}) {
  const candidate = session && typeof session === "object" ? session : {};
  const id =
    sanitizeSessionId(candidate.id) ??
    sanitizeSessionId(defaults.id) ??
    `session-${Date.now().toString(36)}`;
  const index =
    typeof candidate.index === "number" && Number.isInteger(candidate.index) && candidate.index > 0
      ? candidate.index
      : typeof defaults.index === "number" && Number.isInteger(defaults.index) && defaults.index > 0
        ? defaults.index
        : 1;
  const preferredLabel =
    typeof candidate.label === "string" && candidate.label.trim() && candidate.label.trim() !== "New session"
      ? candidate.label.trim()
      : null;
  const defaultLabel =
    typeof defaults.label === "string" && defaults.label.trim() && defaults.label.trim() !== "New session"
      ? defaults.label.trim()
      : null;
  const label =
    preferredLabel
      ? preferredLabel
      : defaultLabel
        ? defaultLabel
        : `Session ${index}`;
  const updatedAt =
    typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
      ? candidate.updatedAt
      : typeof defaults.updatedAt === "string" && defaults.updatedAt.trim()
        ? defaults.updatedAt
        : new Date().toISOString();

  return {
    id,
    label,
    index,
    updatedAt,
  };
}

function normalizeDevSelection(record, sessionDefaults = {}) {
  const candidate = record && typeof record === "object" ? record : {};
  const page = candidate.page && typeof candidate.page === "object" ? candidate.page : {};
  const rawElements = Array.isArray(candidate.elements) ? candidate.elements : [];
  const elements = rawElements.map(normalizeElement);
  const fallbackElement = normalizeElement(candidate.element);
  const normalizedElements = elements.length > 0 ? elements : [fallbackElement];

  return {
    version: 1,
    capturedAt:
      typeof candidate.capturedAt === "string" && candidate.capturedAt.trim()
        ? candidate.capturedAt
        : new Date().toISOString(),
    page: {
      url: typeof page.url === "string" ? page.url : "",
      pathname: typeof page.pathname === "string" ? page.pathname : "",
      title: typeof page.title === "string" ? page.title : "",
    },
    session: normalizeSession(candidate.session, sessionDefaults),
    element: normalizedElements[normalizedElements.length - 1],
    elements: normalizedElements,
  };
}

export class DevSelectionStore {
  constructor(root) {
    this.root = resolve(root);
    this.stateDir = resolveAgentPickerStateDir();
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
      });
    } catch {
      return null;
    }
  }

  read() {
    try {
      return normalizeDevSelection(JSON.parse(readFileSync(this.selectionPath, "utf8")));
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
