const LIVE_CAPTURE_OFFSCREEN_DOCUMENT_PATH = "offscreen-recording.html";
const LIVE_CAPTURE_OFFSCREEN_TARGET = "offscreen-live-capture";
const LIVE_CAPTURE_TIMEOUT_MS = 20_000;
const LIVE_CAPTURE_DEFAULT_FPS = 30;

function getLiveCaptureStateStore() {
  if (!globalThis.__kumaPickerLiveCaptureState) {
    globalThis.__kumaPickerLiveCaptureState = {
      offscreenCreatePromise: null,
      activeSession: null,
      pendingStops: new Map(),
    };
  }

  return globalThis.__kumaPickerLiveCaptureState;
}

function createLiveCaptureDeferred() {
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

function sanitizeLiveCaptureFilenameSegment(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const normalized = candidate
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "");

  return normalized || "capture";
}

function formatLiveCaptureTimestamp(value) {
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

function normalizeLiveCaptureFilename(filename, tab, startedAtIso) {
  const raw = typeof filename === "string" ? filename.trim() : "";
  if (raw) {
    const parts = raw
      .split(/[\\/]+/)
      .map((part) => sanitizeLiveCaptureFilenameSegment(part))
      .filter(Boolean);
    const joined = parts.join("/");
    return joined.toLowerCase().endsWith(".webm") ? joined : `${joined}.webm`;
  }

  let hostname = "browser";
  try {
    hostname = sanitizeLiveCaptureFilenameSegment(new URL(tab.url).hostname || "browser");
  } catch {
    hostname = "browser";
  }

  return `kuma-picker-live-captures/${hostname}-${formatLiveCaptureTimestamp(startedAtIso)}.webm`;
}

async function hasLiveCaptureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(LIVE_CAPTURE_OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  return contexts.length > 0;
}

async function ensureLiveCaptureOffscreenDocument() {
  if (await hasLiveCaptureOffscreenDocument()) {
    return;
  }

  const state = getLiveCaptureStateStore();
  if (state.offscreenCreatePromise) {
    await state.offscreenCreatePromise;
    return;
  }

  state.offscreenCreatePromise = chrome.offscreen.createDocument({
    url: LIVE_CAPTURE_OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Capture high-quality live browser video for Kuma Picker.",
  });

  try {
    await state.offscreenCreatePromise;
  } finally {
    state.offscreenCreatePromise = null;
  }
}

async function sendMessageToLiveCaptureOffscreen(message) {
  await ensureLiveCaptureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    ...message,
    target: LIVE_CAPTURE_OFFSCREEN_TARGET,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "The live capture offscreen document rejected the message.");
  }

  return response.result ?? null;
}

function withLiveCaptureTimeout(promise, timeoutMs, timeoutMessage) {
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

async function downloadLiveCaptureVideo(result, filename) {
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

function serializeLiveCaptureState() {
  const session = getLiveCaptureStateStore().activeSession;
  if (!session) {
    return {
      active: false,
      recording: null,
    };
  }

  return {
    active: true,
    recording: {
      id: session.id,
      tabId: session.targetTabId,
      page: session.page,
      filename: session.filename,
      fps: session.fps,
      startedAt: session.startedAt,
      status: session.status,
    },
  };
}

function assertLiveCaptureTabMatches(tab) {
  const session = getLiveCaptureStateStore().activeSession;
  if (!session) {
    throw new Error("No live capture is currently active.");
  }

  if (tab?.id !== session.targetTabId) {
    throw new Error(`The active live capture belongs to tab ${session.targetTabId}, not tab ${tab?.id ?? "unknown"}.`);
  }

  return session;
}

function getLiveCaptureStateForTab(tab) {
  const session = getLiveCaptureStateStore().activeSession;
  if (!session) {
    return {
      active: false,
      recording: null,
    };
  }

  if (tab?.id !== session.targetTabId) {
    return {
      active: false,
      recording: null,
      activeElsewhere: true,
      activeTabId: session.targetTabId,
    };
  }

  return serializeLiveCaptureState();
}

async function startLiveCapture(message = {}) {
  const state = getLiveCaptureStateStore();
  if (state.activeSession) {
    throw new Error("A live capture is already active. Stop it before starting another one.");
  }
  if (getRecordingState().activeRecordingSession) {
    throw new Error("Stop the current debug recording before starting a live capture.");
  }

  const targetTab = await resolveTargetTab(message);
  if (!targetTab?.id || !targetTab.windowId || !targetTab.url) {
    throw new Error("No target tab is available for live capture.");
  }

  const startedAt = new Date().toISOString();
  const requestedStreamId = typeof message?.streamId === "string" ? message.streamId.trim() : "";
  const streamId = requestedStreamId || (await chrome.tabCapture.getMediaStreamId({ targetTabId: targetTab.id }));
  const recordingId = `live-capture-${Date.now().toString(36)}`;
  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : LIVE_CAPTURE_DEFAULT_FPS;
  const filename = normalizeLiveCaptureFilename(message?.filename, targetTab, startedAt);

  await sendMessageToLiveCaptureOffscreen({
    type: "kuma-picker:live-capture-start",
    recordingId,
    streamId,
    fps,
  });

  state.activeSession = {
    id: recordingId,
    targetTabId: targetTab.id,
    startedAt,
    fps,
    filename,
    page: createPageRecordFromTab(targetTab),
    status: "recording",
  };

  return {
    ok: true,
    message: "Live capture started.",
    ...serializeLiveCaptureState(),
  };
}

async function stopLiveCapture() {
  const state = getLiveCaptureStateStore();
  const session = state.activeSession;
  if (!session) {
    throw new Error("No live capture is currently active.");
  }

  session.status = "stopping";
  const deferred = createLiveCaptureDeferred();
  state.pendingStops.set(session.id, deferred);

  try {
    await sendMessageToLiveCaptureOffscreen({
      type: "kuma-picker:live-capture-stop",
      recordingId: session.id,
    });

    const result = await withLiveCaptureTimeout(
      deferred.promise,
      LIVE_CAPTURE_TIMEOUT_MS,
      "Timed out waiting for the live capture to finish encoding.",
    );
    const download = await downloadLiveCaptureVideo(result, session.filename);

    return {
      ok: true,
      message: "Live capture saved.",
      active: false,
      recording: {
        id: session.id,
        filename: session.filename,
        startedAt: session.startedAt,
        stoppedAt: new Date().toISOString(),
        fps: session.fps,
        bytes: result.bytes,
        mimeType: result.mimeType,
      },
      download: serializeDownloadResult(download.record, {
        filenameContains: session.filename.split("/").at(-1) ?? null,
        downloadUrlContains: null,
        startedAfter: session.startedAt,
        contextTargetUrl: session.page?.url ?? null,
      }),
      downloadId: download.downloadId,
    };
  } finally {
    state.pendingStops.delete(session.id);
    state.activeSession = null;
    if (!getRecordingState().activeRecordingSession) {
      await closeRecordingOffscreenDocument().catch(() => null);
    }
  }
}

async function stopLiveCaptureForTab(tab) {
  assertLiveCaptureTabMatches(tab);
  return stopLiveCapture();
}

async function handleLiveCaptureFinished(message) {
  const state = getLiveCaptureStateStore();
  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  const pending = state.pendingStops.get(recordingId);
  if (!pending) {
    return { ok: true, ignored: true };
  }

  pending.resolve({
    dataUrl: typeof message?.dataUrl === "string" ? message.dataUrl : "",
    mimeType: typeof message?.mimeType === "string" ? message.mimeType : "video/webm",
    bytes: Number.isFinite(message?.bytes) ? Math.max(0, Math.round(message.bytes)) : 0,
  });

  return { ok: true };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const state = getLiveCaptureStateStore();
  if (state.activeSession?.targetTabId === tabId) {
    const pending = state.pendingStops.get(state.activeSession.id);
    pending?.reject(new Error("The live-captured tab was closed before encoding finished."));
    state.pendingStops.delete(state.activeSession.id);
    state.activeSession = null;
  }
});
