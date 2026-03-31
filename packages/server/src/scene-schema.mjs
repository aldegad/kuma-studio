const DEFAULT_SCENE = {
  version: 1,
  meta: {
    zoom: 1,
    revision: 0,
  },
  nodes: [],
};

const ALLOWED_VIEWPORTS = new Set(["desktop", "mobile", "original", "mark"]);
const DEFAULT_OFFICE_LAYOUT = {
  background: "woodland-office",
  characters: [],
  furniture: [],
};

export function createEmptyScene() {
  return structuredClone(DEFAULT_SCENE);
}

export function normalizeViewport(value) {
  const viewport = String(value);
  return viewport === "mark" ? "original" : viewport;
}

export function currentTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function createEmptyOfficeLayout() {
  return structuredClone(DEFAULT_OFFICE_LAYOUT);
}

export function ensureOfficeLayoutShape(layout) {
  if (layout == null) {
    return createEmptyOfficeLayout();
  }

  if (typeof layout !== "object" || Array.isArray(layout)) {
    throw new Error("Office layout must be an object");
  }

  const background = typeof layout.background === "string" && layout.background.trim()
    ? layout.background
    : DEFAULT_OFFICE_LAYOUT.background;

  if (!Array.isArray(layout.characters)) {
    throw new Error("Office layout characters must be an array");
  }

  if (!Array.isArray(layout.furniture)) {
    throw new Error("Office layout furniture must be an array");
  }

  return {
    background,
    characters: layout.characters.map((character) => ({
      id: String(character?.id ?? ""),
      position: ensureOfficePosition(character?.position),
    })),
    furniture: layout.furniture.map((furniture) => ({
      id: String(furniture?.id ?? ""),
      type: typeof furniture?.type === "string" && furniture.type.trim() ? furniture.type : "item",
      position: ensureOfficePosition(furniture?.position),
      imageUrl: typeof furniture?.imageUrl === "string" ? furniture.imageUrl : "",
    })),
  };
}

export function ensureSceneShape(scene) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    throw new Error("Scene must be an object");
  }

  const version =
    Number.isInteger(scene.version) && scene.version > 0 ? scene.version : DEFAULT_SCENE.version;

  const meta = scene.meta && typeof scene.meta === "object" && !Array.isArray(scene.meta) ? scene.meta : {};
  const normalizedMeta = {
    zoom: typeof meta.zoom === "number" && Number.isFinite(meta.zoom) ? meta.zoom : 1,
    revision: Number.isInteger(meta.revision) && meta.revision >= 0 ? meta.revision : 0,
  };

  if (typeof meta.updatedAt === "string") {
    normalizedMeta.updatedAt = meta.updatedAt;
  }

  if (meta.selectedStudyId == null) {
    normalizedMeta.selectedStudyId = null;
  } else if (typeof meta.selectedStudyId === "string") {
    normalizedMeta.selectedStudyId = meta.selectedStudyId;
  }

  if (meta.officeLayout != null) {
    normalizedMeta.officeLayout = ensureOfficeLayoutShape(meta.officeLayout);
  }

  if (!Array.isArray(scene.nodes)) {
    throw new Error("Scene.nodes must be an array");
  }

  const normalizedNodes = scene.nodes.map((rawNode) => {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      throw new Error("Each node must be an object");
    }

    const requiredKeys = ["id", "itemId", "title", "viewport", "x", "y", "zIndex"];
    const missingKeys = requiredKeys.filter((key) => !(key in rawNode));
    if (missingKeys.length > 0) {
      throw new Error(`Node is missing keys: ${missingKeys.join(", ")}`);
    }

    const viewport = normalizeViewport(rawNode.viewport);
    if (!ALLOWED_VIEWPORTS.has(viewport)) {
      throw new Error(`Unsupported viewport: ${viewport}`);
    }

    if (rawNode.propsPatch != null && (typeof rawNode.propsPatch !== "object" || Array.isArray(rawNode.propsPatch))) {
      throw new Error("Node.propsPatch must be an object");
    }

    return {
      id: String(rawNode.id),
      itemId: String(rawNode.itemId),
      title: String(rawNode.title),
      viewport,
      x: typeof rawNode.x === "number" && Number.isFinite(rawNode.x) ? rawNode.x : 0,
      y: typeof rawNode.y === "number" && Number.isFinite(rawNode.y) ? rawNode.y : 0,
      zIndex: Number.isInteger(rawNode.zIndex) ? rawNode.zIndex : 0,
      hidden: Boolean(rawNode.hidden),
      locked: Boolean(rawNode.locked),
      propsPatch: rawNode.propsPatch && typeof rawNode.propsPatch === "object" ? rawNode.propsPatch : {},
    };
  });

  return {
    version,
    meta: normalizedMeta,
    nodes: normalizedNodes.sort((left, right) => left.zIndex - right.zIndex),
  };
}

function ensureOfficePosition(position) {
  if (!position || typeof position !== "object" || Array.isArray(position)) {
    return { x: 0, y: 0 };
  }

  return {
    x: typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0,
    y: typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0,
  };
}

export function encodeSceneEvent(scene, source) {
  const normalized = ensureSceneShape(scene);
  return `event: scene\ndata: ${JSON.stringify({
    type: "scene.updated",
    source,
    revision: normalized.meta.revision ?? 0,
    updatedAt: normalized.meta.updatedAt,
  })}\n\n`;
}

export function encodeJobCardEvent(card, source, deleted = false) {
  const id = typeof card?.id === "string" ? card.id : null;
  if (!id) {
    throw new Error("Job card event requires id");
  }

  return `event: job-card\ndata: ${JSON.stringify({
    type: "job-card.updated",
    source,
    id,
    deleted: Boolean(deleted),
    updatedAt: typeof card?.updatedAt === "string" ? card.updatedAt : undefined,
    card: deleted ? null : card,
  })}\n\n`;
}
