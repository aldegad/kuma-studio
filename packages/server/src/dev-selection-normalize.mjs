function normalizeRect(rect) {
  const candidate = rect && typeof rect === "object" ? rect : {};

  return {
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0,
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
  };
}

function normalizePoint(point) {
  const candidate = point && typeof point === "object" ? point : {};
  const x = typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : null;
  const y = typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : null;

  if (x == null || y == null) {
    return null;
  }

  return {
    x,
    y,
  };
}

function normalizeJob(job) {
  const candidate = job && typeof job === "object" ? job : null;
  if (!candidate) {
    return null;
  }

  const message = typeof candidate.message === "string" ? candidate.message.trim() : "";
  if (!message) {
    return null;
  }

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : `job-${Date.now().toString(36)}`,
    message,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : new Date().toISOString(),
    author:
      typeof candidate.author === "string" && candidate.author.trim()
        ? candidate.author.trim()
        : "user",
    status: candidate.status === "in_progress" || candidate.status === "completed" ? candidate.status : "noted",
  };
}

export function sanitizeSessionId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return /^[a-zA-Z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
}

export function sanitizeAssetFileName(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,128}$/.test(trimmed) ? trimmed : null;
}

export function normalizeSnapshot(snapshot) {
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

export function parseSnapshotPayload(snapshot) {
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

export function extensionForMimeType(mimeType) {
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

export function mimeTypeForFileName(fileName) {
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
    pickedPoint: normalizePoint(candidate.pickedPoint),
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
  const label = preferredLabel ? preferredLabel : defaultLabel ? defaultLabel : `Session ${index}`;
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

function normalizeOptionalString(value, maxLength = 2000) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 32);
}

export function normalizeDevSelection(record, sessionDefaults = {}) {
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
    projectId:
      normalizeOptionalString(candidate.projectId, 240) ??
      normalizeOptionalString(sessionDefaults.projectId, 240),
    projectRoot: normalizeOptionalString(candidate.projectRoot) ?? normalizeOptionalString(sessionDefaults.projectRoot),
    taskId:
      normalizeOptionalString(candidate.taskId, 240) ??
      normalizeOptionalString(sessionDefaults.taskId, 240),
    tags: Array.isArray(candidate.tags) ? normalizeTags(candidate.tags) : normalizeTags(sessionDefaults.tags),
    page: {
      url: typeof page.url === "string" ? page.url : "",
      pathname: typeof page.pathname === "string" ? page.pathname : "",
      title: typeof page.title === "string" ? page.title : "",
      tabId: Number.isInteger(page.tabId) ? page.tabId : null,
    },
    session: normalizeSession(candidate.session, sessionDefaults),
    job: normalizeJob(candidate.job),
    element: normalizedElements[normalizedElements.length - 1],
    elements: normalizedElements,
  };
}
