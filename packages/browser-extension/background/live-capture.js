const LIVE_CAPTURE_OFFSCREEN_DOCUMENT_PATH = "offscreen-recording.html";
const LIVE_CAPTURE_OFFSCREEN_TARGET = "offscreen-live-capture";
const LIVE_CAPTURE_TIMEOUT_MS = 120_000;
const LIVE_CAPTURE_DEFAULT_FPS = 30;

function normalizeLiveCaptureKind(value) {
  return value === "screen" || value === "window" ? value : "tab";
}

function getLiveCaptureKindLabel(kind) {
  switch (normalizeLiveCaptureKind(kind)) {
    case "window":
      return "Window";
    case "screen":
      return "Screen";
    default:
      return "Current tab";
  }
}

function getLiveCaptureStateStore() {
  if (!globalThis.__kumaPickerLiveCaptureState) {
    globalThis.__kumaPickerLiveCaptureState = {
      offscreenCreatePromise: null,
      preparedSession: null,
      studioSession: null,
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
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA"],
    justification: "Capture high-quality live browser, window, or screen video for Kuma Picker.",
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
  const downloadUrl = typeof result?.downloadUrl === "string" && result.downloadUrl ? result.downloadUrl : "";

  if (!downloadUrl) {
    throw new Error("The live capture did not return a downloadable URL.");
  }

  const downloadId = await chrome.downloads.download({
    url: downloadUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });

  return {
    downloadId,
    record: await refreshDownloadRecord(downloadId),
  };
}

async function releaseLiveCaptureDownloadUrl(session, result) {
  if (result?.downloadUrlType !== "object-url" || typeof result?.downloadUrl !== "string" || !result.downloadUrl) {
    return;
  }

  await sendMessageToLiveCaptureOffscreen({
    type: "kuma-picker:live-capture-release-download-url",
    recordingId: session?.id ?? "",
    downloadUrl: result.downloadUrl,
  }).catch(() => null);
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
      captureKind: session.captureKind,
      captureLabel: session.captureLabel,
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

async function resolveLiveCaptureStreamId(targetTab, message = {}) {
  const requestedStreamId = typeof message?.streamId === "string" ? message.streamId.trim() : "";
  if (requestedStreamId) {
    return requestedStreamId;
  }

  const captureKind = normalizeLiveCaptureKind(message?.captureKind);
  if (captureKind !== "tab") {
    throw new Error(`A ${captureKind} live capture requires a desktop stream id from the chooser.`);
  }

  return chrome.tabCapture.getMediaStreamId({ targetTabId: targetTab.id });
}

async function openLiveCaptureStudio(message = {}) {
  const state = getLiveCaptureStateStore();
  if (state.activeSession) {
    throw new Error("Stop the current live capture before opening Capture Studio.");
  }
  if (state.studioSession?.studioTabId) {
    try {
      const existingTab = await chrome.tabs.get(state.studioSession.studioTabId);
      if (existingTab?.windowId) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
        await chrome.tabs.update(existingTab.id, { active: true });
        return {
          ok: true,
          message: "Capture Studio is already open.",
        };
      }
    } catch {
      state.studioSession = null;
    }
  }

  const targetTab = await resolveTargetTab(message);
  if (!targetTab?.id || !targetTab.windowId || !targetTab.url) {
    throw new Error("No target tab is available for Capture Studio.");
  }

  const captureKind = normalizeLiveCaptureKind(message?.captureKind);
  if (captureKind === "tab") {
    throw new Error("Capture Studio is only needed for window or screen capture.");
  }

  const startedAt = new Date().toISOString();
  const recordingId = `live-capture-${Date.now().toString(36)}`;
  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : LIVE_CAPTURE_DEFAULT_FPS;
  const filename = normalizeLiveCaptureFilename(message?.filename, targetTab, startedAt);
  const studioUrl = new URL(chrome.runtime.getURL("capture-studio.html"));
  studioUrl.searchParams.set("studioId", recordingId);
  const studioWindow = await chrome.windows.create({
    url: studioUrl.toString(),
    type: "popup",
    focused: true,
    width: 980,
    height: 980,
  });
  const studioTab = Array.isArray(studioWindow.tabs) ? studioWindow.tabs[0] : null;
  if (!studioTab?.id) {
    throw new Error("Failed to open Capture Studio.");
  }

  state.studioSession = {
    id: recordingId,
    targetTabId: targetTab.id,
    studioTabId: studioTab.id,
    studioWindowId: studioWindow.id ?? null,
    startedAt,
    fps,
    filename,
    page: createPageRecordFromTab(targetTab),
    captureKind,
    captureLabel: getLiveCaptureKindLabel(captureKind),
    mode: "studio",
    status: "opening",
  };

  return {
    ok: true,
    message: "Capture Studio opened.",
    studio: {
      id: recordingId,
      tabId: studioTab.id,
      windowId: studioWindow.id ?? null,
    },
  };
}

async function getLiveCaptureStudioContext(message = {}, sender = {}) {
  const state = getLiveCaptureStateStore();
  const studioId = typeof message?.studioId === "string" ? message.studioId.trim() : "";
  const studioSession = state.studioSession;
  if (!studioSession || !studioId || studioSession.id !== studioId) {
    return {
      ok: false,
      error: "Capture Studio session was not found.",
    };
  }

  if (sender.tab?.id && sender.tab.id !== studioSession.studioTabId) {
    return {
      ok: false,
      error: "Capture Studio context belongs to another tab.",
    };
  }

  return {
    ok: true,
    studio: {
      id: studioSession.id,
      targetTabId: studioSession.targetTabId,
      page: studioSession.page,
      captureKind: studioSession.captureKind,
      captureLabel: studioSession.captureLabel,
      fps: studioSession.fps,
      filename: studioSession.filename,
    },
  };
}

async function handleStudioLiveCaptureStarted(message = {}, sender = {}) {
  const state = getLiveCaptureStateStore();
  const studioSession = state.studioSession;
  const studioId = typeof message?.studioId === "string" ? message.studioId.trim() : "";
  if (!studioSession || !studioId || studioSession.id !== studioId) {
    return {
      ok: false,
      error: "Capture Studio session was not found.",
    };
  }

  if (sender.tab?.id !== studioSession.studioTabId) {
    return {
      ok: false,
      error: "Only the matching Capture Studio tab can start this recording.",
    };
  }

  const streamId = typeof message?.streamId === "string" ? message.streamId.trim() : "";
  if (!streamId) {
    return {
      ok: false,
      error: "Capture Studio must provide a desktop stream id before recording.",
    };
  }

  state.activeSession = {
    ...studioSession,
    mode: "studio-local",
    status: "recording",
    startedAt: typeof message?.startedAt === "string" && message.startedAt ? message.startedAt : studioSession.startedAt,
  };
  state.studioSession = null;

  return {
    ok: true,
    ...serializeLiveCaptureState(),
  };
}

function abortStudioLiveCapture(message = {}, sender = {}) {
  const state = getLiveCaptureStateStore();
  const studioId = typeof message?.studioId === "string" ? message.studioId.trim() : "";
  const session = state.activeSession;
  if (!session || !studioId || session.id !== studioId || session.mode !== "studio-local") {
    return {
      ok: true,
      ignored: true,
    };
  }

  if (sender.tab?.id && sender.tab.id !== session.studioTabId) {
    return {
      ok: false,
      error: "Only the matching Capture Studio tab can abort this recording start.",
    };
  }

  state.activeSession = null;
  return {
    ok: true,
    aborted: true,
  };
}

async function stopStudioLocalCapture(session) {
  let response = null;
  try {
    response = await chrome.runtime.sendMessage({
      target: "capture-studio",
      type: "kuma-picker:studio-stop-local-live-capture",
      studioId: session.id,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  if (!response?.ok) {
    throw new Error(response?.error || "Capture Studio could not stop the local recording.");
  }

  return {
    ok: true,
    message: response.message || "Live capture saved.",
    active: false,
    recording: {
      id: session.id,
      filename: session.filename,
      startedAt: session.startedAt,
      stoppedAt: typeof response?.stoppedAt === "string" && response.stoppedAt ? response.stoppedAt : new Date().toISOString(),
      fps: session.fps,
      bytes: Number.isFinite(response?.bytes) ? Math.max(0, Math.round(response.bytes)) : 0,
      mimeType: typeof response?.mimeType === "string" && response.mimeType ? response.mimeType : "video/webm",
    },
    downloadId: Number.isInteger(response?.downloadId) ? response.downloadId : null,
  };
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

  const preparedCaptureId = typeof message?.preparedCaptureId === "string" ? message.preparedCaptureId.trim() : "";
  if (preparedCaptureId) {
    const preparedSession = state.preparedSession;
    if (!preparedSession || preparedSession.id !== preparedCaptureId) {
      throw new Error("No matching prepared live capture is available.");
    }

    if (preparedSession.targetTabId !== targetTab.id) {
      throw new Error(`The prepared live capture belongs to tab ${preparedSession.targetTabId}, not tab ${targetTab.id}.`);
    }

    try {
      await sendMessageToLiveCaptureOffscreen({
        type: "kuma-picker:live-capture-begin",
        recordingId: preparedSession.id,
        cropRect:
          message?.cropRect &&
          typeof message.cropRect === "object" &&
          Number.isFinite(message.cropRect.x) &&
          Number.isFinite(message.cropRect.y) &&
          Number.isFinite(message.cropRect.width) &&
          Number.isFinite(message.cropRect.height)
            ? {
                x: message.cropRect.x,
                y: message.cropRect.y,
                width: message.cropRect.width,
                height: message.cropRect.height,
              }
            : null,
      });
    } catch (error) {
      await sendMessageToLiveCaptureOffscreen({
        type: "kuma-picker:live-capture-discard",
        recordingId: preparedSession.id,
      }).catch(() => null);
      state.preparedSession = null;
      throw error;
    }

    state.activeSession = {
      ...preparedSession,
      status: "recording",
    };
    state.preparedSession = null;
  } else {
    const startedAt = new Date().toISOString();
    const captureKind = normalizeLiveCaptureKind(message?.captureKind);
    const streamId = await resolveLiveCaptureStreamId(targetTab, message);
    const canRequestAudioTrack = message?.canRequestAudioTrack === true;
    const recordingId = `live-capture-${Date.now().toString(36)}`;
    const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : LIVE_CAPTURE_DEFAULT_FPS;
    const filename = normalizeLiveCaptureFilename(message?.filename, targetTab, startedAt);

    await sendMessageToLiveCaptureOffscreen({
      type: "kuma-picker:live-capture-start",
      recordingId,
      streamId,
      captureKind,
      canRequestAudioTrack,
      fps,
    });

    state.activeSession = {
      id: recordingId,
      targetTabId: targetTab.id,
      startedAt,
      fps,
      filename,
      page: createPageRecordFromTab(targetTab),
      captureKind,
      captureLabel: getLiveCaptureKindLabel(captureKind),
      status: "recording",
    };
  }

  return {
    ok: true,
    message: "Live capture started.",
    ...serializeLiveCaptureState(),
  };
}

async function prepareLiveCapture(message = {}) {
  const state = getLiveCaptureStateStore();
  if (state.activeSession) {
    throw new Error("Stop the current live capture before preparing another one.");
  }
  if (state.preparedSession) {
    await discardPreparedLiveCapture({ preparedCaptureId: state.preparedSession.id }).catch(() => null);
  }

  const targetTab = await resolveTargetTab(message);
  if (!targetTab?.id || !targetTab.windowId || !targetTab.url) {
    throw new Error("No target tab is available for live capture.");
  }

  const startedAt = new Date().toISOString();
  const captureKind = normalizeLiveCaptureKind(message?.captureKind);
  const streamId = await resolveLiveCaptureStreamId(targetTab, message);
  const canRequestAudioTrack = message?.canRequestAudioTrack === true;
  const recordingId = `live-capture-${Date.now().toString(36)}`;
  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : LIVE_CAPTURE_DEFAULT_FPS;
  const filename = normalizeLiveCaptureFilename(message?.filename, targetTab, startedAt);
  const preview = await sendMessageToLiveCaptureOffscreen({
    type: "kuma-picker:live-capture-prepare",
    recordingId,
    streamId,
    captureKind,
    canRequestAudioTrack,
    fps,
  });

  state.preparedSession = {
    id: recordingId,
    targetTabId: targetTab.id,
    startedAt,
    fps,
    filename,
    page: createPageRecordFromTab(targetTab),
    captureKind,
    captureLabel: getLiveCaptureKindLabel(captureKind),
    status: "prepared",
  };

  return {
    ok: true,
    preparedCapture: {
      id: recordingId,
      captureKind,
      captureLabel: getLiveCaptureKindLabel(captureKind),
      sourceWidth: preview.sourceWidth,
      sourceHeight: preview.sourceHeight,
      previewDataUrl: preview.previewDataUrl,
    },
  };
}

async function discardPreparedLiveCapture(message = {}) {
  const state = getLiveCaptureStateStore();
  const preparedSession = state.preparedSession;
  if (!preparedSession) {
    return {
      ok: true,
      ignored: true,
    };
  }

  const preparedCaptureId = typeof message?.preparedCaptureId === "string" ? message.preparedCaptureId.trim() : "";
  if (preparedCaptureId && preparedCaptureId !== preparedSession.id) {
    throw new Error(`The prepared live capture belongs to ${preparedSession.id}, not ${preparedCaptureId}.`);
  }

  await sendMessageToLiveCaptureOffscreen({
    type: "kuma-picker:live-capture-discard",
    recordingId: preparedSession.id,
  }).catch(() => null);
  state.preparedSession = null;

  return {
    ok: true,
  };
}

async function stopLiveCapture() {
  const state = getLiveCaptureStateStore();
  const session = state.activeSession;
  if (!session) {
    throw new Error("No live capture is currently active.");
  }

  if (session.mode === "studio-local") {
    session.status = "stopping";
    try {
      return await stopStudioLocalCapture(session);
    } finally {
      state.activeSession = null;
    }
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
    try {
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
      await releaseLiveCaptureDownloadUrl(session, result);
    }
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
    downloadUrl: typeof message?.downloadUrl === "string" ? message.downloadUrl : "",
    downloadUrlType: typeof message?.downloadUrlType === "string" ? message.downloadUrlType : "object-url",
    mimeType: typeof message?.mimeType === "string" ? message.mimeType : "video/webm",
    bytes: Number.isFinite(message?.bytes) ? Math.max(0, Math.round(message.bytes)) : 0,
  });

  return { ok: true };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const state = getLiveCaptureStateStore();
  if (state.studioSession?.studioTabId === tabId) {
    state.studioSession = null;
  }
  if (state.preparedSession?.targetTabId === tabId) {
    void discardPreparedLiveCapture({ preparedCaptureId: state.preparedSession.id });
  }
  if (state.activeSession?.targetTabId === tabId || state.activeSession?.studioTabId === tabId) {
    const pending = state.pendingStops.get(state.activeSession.id);
    pending?.reject(new Error("The live-captured tab was closed before encoding finished."));
    state.pendingStops.delete(state.activeSession.id);
    state.activeSession = null;
  }
});
