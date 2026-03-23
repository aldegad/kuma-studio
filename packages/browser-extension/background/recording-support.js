function getRecordingConfig() {
  return {
    offscreenDocumentPath: "offscreen-recording.html",
    offscreenTarget: "offscreen-recording",
    recordingTimeoutMs: 20_000,
    defaultRecordingFps: 2,
    maxVisibleTabRecordingFps: 2,
    defaultSpeedMultiplier: 3,
  };
}

function getRecordingState() {
  if (!globalThis.__kumaPickerRecordingState) {
    globalThis.__kumaPickerRecordingState = {
      recordingOffscreenCreatePromise: null,
      activeRecordingSession: null,
      pendingRecordingCompletions: new Map(),
    };
  }

  return globalThis.__kumaPickerRecordingState;
}

function createDeferred() {
  let resolvePromise = null;
  let rejectPromise = null;

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function sanitizeRecordingFilenameSegment(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const normalized = candidate
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "");

  return normalized || "recording";
}

function formatRecordingTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];

  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

function normalizeRecordingFilename(filename, tab, startedAtIso) {
  const raw = typeof filename === "string" ? filename.trim() : "";
  if (raw) {
    const parts = raw
      .split(/[\\/]+/)
      .map((part) => sanitizeRecordingFilenameSegment(part))
      .filter(Boolean);
    const joined = parts.join("/");
    return joined.toLowerCase().endsWith(".webm") ? joined : `${joined}.webm`;
  }

  let hostname = "browser";
  try {
    hostname = sanitizeRecordingFilenameSegment(new URL(tab.url).hostname || "browser");
  } catch {
    hostname = "browser";
  }

  return `kuma-picker-recordings/${hostname}-${formatRecordingTimestamp(startedAtIso)}.webm`;
}

function readPngDataUrlDimensions(dataUrl) {
  const prefix = "data:image/png;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) {
    throw new Error("Kuma Picker recording frames must be PNG data URLs.");
  }

  const binary = atob(dataUrl.slice(prefix.length));
  if (binary.length < 24) {
    throw new Error("The PNG frame is too small to read its dimensions.");
  }

  const readUint32 = (offset) =>
    ((binary.charCodeAt(offset) << 24) >>> 0) |
    (binary.charCodeAt(offset + 1) << 16) |
    (binary.charCodeAt(offset + 2) << 8) |
    binary.charCodeAt(offset + 3);

  return {
    width: readUint32(16),
    height: readUint32(20),
  };
}

async function hasRecordingOffscreenDocument() {
  const { offscreenDocumentPath } = getRecordingConfig();
  const offscreenUrl = chrome.runtime.getURL(offscreenDocumentPath);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  return contexts.length > 0;
}

async function ensureRecordingOffscreenDocument() {
  if (await hasRecordingOffscreenDocument()) {
    return;
  }

  const recordingState = getRecordingState();
  if (recordingState.recordingOffscreenCreatePromise) {
    await recordingState.recordingOffscreenCreatePromise;
    return;
  }

  const { offscreenDocumentPath } = getRecordingConfig();
  recordingState.recordingOffscreenCreatePromise = chrome.offscreen.createDocument({
    url: offscreenDocumentPath,
    reasons: ["BLOBS"],
    justification: "Record Kuma Picker browser automation into a debugging video.",
  });

  try {
    await recordingState.recordingOffscreenCreatePromise;
  } finally {
    recordingState.recordingOffscreenCreatePromise = null;
  }
}

async function closeRecordingOffscreenDocument() {
  if (await hasRecordingOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

async function sendMessageToRecordingOffscreen(message) {
  const { offscreenTarget } = getRecordingConfig();
  await ensureRecordingOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    ...message,
    target: offscreenTarget,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "The offscreen recording document rejected the message.");
  }

  return response.result ?? null;
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

async function downloadRecordedVideo(result, filename) {
  const downloadId = await chrome.downloads.download({
    url: result.dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });

  return {
    downloadId,
    record: await refreshDownloadRecord(downloadId),
  };
}

function normalizeRecordingCompletion(message) {
  return {
    dataUrl: typeof message?.dataUrl === "string" ? message.dataUrl : "",
    mimeType: typeof message?.mimeType === "string" ? message.mimeType : "video/webm",
    bytes: Number.isFinite(message?.bytes) ? Math.max(0, Math.round(message.bytes)) : 0,
    frameCount: Number.isFinite(message?.frameCount) ? Math.max(0, Math.round(message.frameCount)) : 0,
    renderedFrameCount:
      Number.isFinite(message?.renderedFrameCount) ? Math.max(0, Math.round(message.renderedFrameCount)) : 0,
    durationMs: Number.isFinite(message?.durationMs) ? Math.max(0, Math.round(message.durationMs)) : 0,
    width: Number.isFinite(message?.width) ? Math.max(1, Math.round(message.width)) : 1,
    height: Number.isFinite(message?.height) ? Math.max(1, Math.round(message.height)) : 1,
  };
}
