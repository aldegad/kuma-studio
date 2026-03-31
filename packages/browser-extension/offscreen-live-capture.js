const OFFSCREEN_LIVE_CAPTURE_TARGET = "offscreen-live-capture";
const OFFSCREEN_LIVE_CAPTURE_PORT_NAME = "kuma-picker-live-capture";
const DEFAULT_LIVE_CAPTURE_FPS = 30;
const MAX_PREVIEW_EDGE = 1440;

const liveCaptureCanvas = document.getElementById("recording-canvas");
const liveCaptureContext = liveCaptureCanvas.getContext("2d", { alpha: false });
const liveCapturePort = chrome.runtime.connect({ name: OFFSCREEN_LIVE_CAPTURE_PORT_NAME });

let preparedLiveCapture = null;
let activeLiveCapture = null;
const pendingDownloadUrls = new Map();

liveCapturePort.onDisconnect.addListener(() => {});

function waitForDelay(delayMs) {
  return new Promise((resolvePromise) => {
    window.setTimeout(resolvePromise, Math.max(0, delayMs));
  });
}

function createBlobDownloadUrl(blob) {
  try {
    const objectUrl = URL.createObjectURL(blob);
    return typeof objectUrl === "string" ? objectUrl : "";
  } catch {
    return "";
  }
}

function releasePendingDownloadUrl(recordingId, downloadUrl = "") {
  const normalizedRecordingId = typeof recordingId === "string" ? recordingId : "";
  const currentDownloadUrl = pendingDownloadUrls.get(normalizedRecordingId);
  if (!currentDownloadUrl) {
    return false;
  }

  if (downloadUrl && currentDownloadUrl !== downloadUrl) {
    return false;
  }

  URL.revokeObjectURL(currentDownloadUrl);
  pendingDownloadUrls.delete(normalizedRecordingId);
  return true;
}

async function publishFinishedLiveCapture({ recordingId, blob, preferredMimeType, startedAt }) {
  const finalBlob = await KumaPickerExtensionRecordingMedia.finalizeRecordedBlob(blob, {
    durationMs: Date.now() - startedAt,
    mimeType: preferredMimeType,
  });
  let downloadUrl = createBlobDownloadUrl(finalBlob);
  if (!downloadUrl) {
    throw new Error("The live capture blob could not be turned into a download URL.");
  }
  const downloadUrlType = "object-url";
  pendingDownloadUrls.set(recordingId, downloadUrl);

  await chrome.runtime.sendMessage({
    type: "kuma-picker:live-capture-finished",
    target: "service-worker",
    recordingId,
    downloadUrl,
    downloadUrlType,
    mimeType: finalBlob.type || preferredMimeType || "video/webm",
    bytes: finalBlob.size,
  });
}

function normalizeLayoutPlan(layoutPlan, sourceWidth, sourceHeight) {
  if (!layoutPlan || typeof layoutPlan !== "object" || !Array.isArray(layoutPlan.sections) || layoutPlan.sections.length === 0) {
    throw new Error("A composed live capture requires a valid layout plan.");
  }

  const sections = layoutPlan.sections
    .map((section) => {
      if (!section || typeof section !== "object") {
        throw new Error("Each live capture layout section must be an object.");
      }
      if (
        !section.sourceRect ||
        typeof section.sourceRect !== "object" ||
        !Number.isFinite(section.sourceRect.x) ||
        !Number.isFinite(section.sourceRect.y) ||
        !Number.isFinite(section.sourceRect.width) ||
        !Number.isFinite(section.sourceRect.height)
      ) {
        throw new Error("Each live capture layout section needs a complete sourceRect.");
      }
      if (
        !section.targetRect ||
        typeof section.targetRect !== "object" ||
        !Number.isFinite(section.targetRect.x) ||
        !Number.isFinite(section.targetRect.y) ||
        !Number.isFinite(section.targetRect.width) ||
        !Number.isFinite(section.targetRect.height)
      ) {
        throw new Error("Each live capture layout section needs a complete targetRect.");
      }
      return {
        sourceRect: {
          x: Math.max(0, Math.round(section.sourceRect.x)),
          y: Math.max(0, Math.round(section.sourceRect.y)),
          width: Math.max(1, Math.round(section.sourceRect.width)),
          height: Math.max(1, Math.round(section.sourceRect.height)),
        },
        targetRect: {
          x: Math.max(0, Math.round(section.targetRect.x)),
          y: Math.max(0, Math.round(section.targetRect.y)),
          width: Math.max(1, Math.round(section.targetRect.width)),
          height: Math.max(1, Math.round(section.targetRect.height)),
        },
      };
    })
    .filter((section) => section.targetRect.width > 0 && section.targetRect.height > 0);

  if (sections.length === 0) {
    throw new Error("A composed live capture requires at least one valid layout section.");
  }

  const canvasWidth =
    Number.isFinite(layoutPlan.canvasWidth) && layoutPlan.canvasWidth > 0
      ? Math.max(1, Math.round(layoutPlan.canvasWidth))
      : Math.max(...sections.map((section) => section.targetRect.x + section.targetRect.width));
  const canvasHeight =
    Number.isFinite(layoutPlan.canvasHeight) && layoutPlan.canvasHeight > 0
      ? Math.max(1, Math.round(layoutPlan.canvasHeight))
      : Math.max(...sections.map((section) => section.targetRect.y + section.targetRect.height));

  return {
    canvasWidth,
    canvasHeight,
    backgroundColor:
      typeof layoutPlan.backgroundColor === "string" && layoutPlan.backgroundColor.trim()
        ? layoutPlan.backgroundColor.trim()
        : "#000000",
    sections,
  };
}

async function createCapturedStream(streamId, fps, captureKind = "tab", canRequestAudioTrack = false) {
  const normalizedCaptureKind = captureKind === "screen" || captureKind === "window" ? captureKind : "tab";
  const mediaSource = normalizedCaptureKind === "tab" ? "tab" : "desktop";
  const videoConstraints = {
    mandatory: {
      chromeMediaSource: mediaSource,
      chromeMediaSourceId: streamId,
      maxFrameRate: Math.max(1, Math.min(60, Math.round(fps) || DEFAULT_LIVE_CAPTURE_FPS)),
    },
  };
  const wantsAudio = canRequestAudioTrack === true;

  return navigator.mediaDevices.getUserMedia({
    audio: wantsAudio
      ? {
          mandatory: {
            chromeMediaSource: mediaSource,
            chromeMediaSourceId: streamId,
          },
        }
      : false,
    video: videoConstraints,
  });
}

async function waitForVideoReady(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return;
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("Timed out waiting for the live capture preview."));
    }, 5_000);

    function cleanup() {
      clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    }

    function handleReady() {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolvePromise();
      }
    }

    function handleError() {
      cleanup();
      rejectPromise(new Error("Failed to load the live capture preview."));
    }

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
  });

  if (typeof video.requestVideoFrameCallback === "function") {
    await new Promise((resolvePromise) => {
      video.requestVideoFrameCallback(() => resolvePromise());
    });
    return;
  }

  await waitForDelay(120);
}

function createPreviewDataUrl(video) {
  const sourceWidth = Math.max(1, Math.round(video.videoWidth) || 1);
  const sourceHeight = Math.max(1, Math.round(video.videoHeight) || 1);
  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(sourceWidth, sourceHeight));
  const previewWidth = Math.max(1, Math.round(sourceWidth * scale));
  const previewHeight = Math.max(1, Math.round(sourceHeight * scale));

  liveCaptureCanvas.width = previewWidth;
  liveCaptureCanvas.height = previewHeight;
  liveCaptureContext.clearRect(0, 0, previewWidth, previewHeight);
  liveCaptureContext.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, previewWidth, previewHeight);

  return {
    previewDataUrl: liveCaptureCanvas.toDataURL("image/png"),
    sourceWidth,
    sourceHeight,
  };
}

function releaseVideo(video) {
  if (!video) {
    return;
  }

  try {
    video.pause();
  } catch {}

  try {
    video.srcObject = null;
  } catch {}

  video.remove();
}

async function createPreparedCapture(message) {
  if (preparedLiveCapture && preparedLiveCapture.id !== message?.recordingId) {
    throw new Error("Another live capture preview is already prepared.");
  }
  if (activeLiveCapture) {
    throw new Error("Another live capture is already active.");
  }

  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  const streamId = typeof message?.streamId === "string" ? message.streamId : "";
  if (!recordingId || !streamId) {
    throw new Error("Live capture preview requires both a recording id and a stream id.");
  }

  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : DEFAULT_LIVE_CAPTURE_FPS;
  const captureKind = message?.captureKind === "screen" || message?.captureKind === "window" ? message.captureKind : "tab";
  const canRequestAudioTrack = message?.canRequestAudioTrack === true;
  const stream = await createCapturedStream(streamId, fps, captureKind, canRequestAudioTrack);
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => null);
  await waitForVideoReady(video);

  const preview = createPreviewDataUrl(video);
  preparedLiveCapture = {
    id: recordingId,
    stream,
    video,
    fps,
    captureKind,
    sourceWidth: preview.sourceWidth,
    sourceHeight: preview.sourceHeight,
  };

  return {
    recordingId,
    previewDataUrl: preview.previewDataUrl,
    sourceWidth: preview.sourceWidth,
    sourceHeight: preview.sourceHeight,
  };
}

function normalizeCropRect(rect, sourceWidth, sourceHeight) {
  if (!rect || typeof rect !== "object") {
    return {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  const x = Number.isFinite(rect.x) ? Math.max(0, Math.round(rect.x)) : 0;
  const y = Number.isFinite(rect.y) ? Math.max(0, Math.round(rect.y)) : 0;
  const maxWidth = Math.max(1, sourceWidth - x);
  const maxHeight = Math.max(1, sourceHeight - y);

  return {
    x,
    y,
    width: Math.min(maxWidth, Math.max(1, Math.round(rect.width) || sourceWidth)),
    height: Math.min(maxHeight, Math.max(1, Math.round(rect.height) || sourceHeight)),
  };
}

async function createAudioPassthrough(stream, captureKind) {
  if (captureKind !== "tab") {
    return null;
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    return null;
  }

  const audioContext = new AudioContext();
  await audioContext.resume().catch(() => null);
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(audioContext.destination);

  return {
    audioContext,
    source,
  };
}

async function cleanupLiveCapture(recording) {
  try {
    if (recording?.renderFrameId) {
      cancelAnimationFrame(recording.renderFrameId);
    }
    recording?.stream?.getTracks?.().forEach((track) => track.stop());
  } finally {
    try {
      recording?.audioPassthrough?.source?.disconnect?.();
    } catch {}

    try {
      await recording?.audioPassthrough?.audioContext?.close?.();
    } catch {}

    try {
      recording?.canvasStream?.getVideoTracks?.().forEach((track) => track.stop());
    } catch {}

    releaseVideo(recording?.video);
    activeLiveCapture = null;
  }
}

async function cleanupPreparedCapture(prepared) {
  try {
    prepared?.stream?.getTracks?.().forEach((track) => track.stop());
  } finally {
    releaseVideo(prepared?.video);
    preparedLiveCapture = null;
  }
}

function renderLayoutPlanFrame(recording) {
  if (!recording) {
    return;
  }

  liveCaptureContext.fillStyle = recording.layoutPlan.backgroundColor || "#000000";
  liveCaptureContext.fillRect(0, 0, liveCaptureCanvas.width, liveCaptureCanvas.height);
  for (const section of recording.layoutPlan.sections) {
    liveCaptureContext.drawImage(
      recording.video,
      section.sourceRect.x,
      section.sourceRect.y,
      section.sourceRect.width,
      section.sourceRect.height,
      section.targetRect.x,
      section.targetRect.y,
      section.targetRect.width,
      section.targetRect.height,
    );
  }
  recording.renderFrameId = requestAnimationFrame(() => {
    if (activeLiveCapture?.id === recording.id) {
      renderLayoutPlanFrame(recording);
    }
  });
}

async function startCanvasComposedCapture({ recordingId, stream, video, fps, captureKind, layoutPlan }) {
  const normalizedLayoutPlan = normalizeLayoutPlan(
    layoutPlan,
    Math.max(1, Math.round(video.videoWidth) || 1),
    Math.max(1, Math.round(video.videoHeight) || 1),
  );
  liveCaptureCanvas.width = normalizedLayoutPlan.canvasWidth;
  liveCaptureCanvas.height = normalizedLayoutPlan.canvasHeight;
  const audioPassthrough = await createAudioPassthrough(stream, captureKind).catch(() => null);
  const canvasStream = liveCaptureCanvas.captureStream(fps);
  const composedStream = new MediaStream([...canvasStream.getVideoTracks(), ...stream.getAudioTracks()]);
  const mimeType = KumaPickerExtensionRecordingMedia.selectSupportedMimeType({
    includeAudio: composedStream.getAudioTracks().length > 0,
  });
  if (!mimeType) {
    throw new Error("This Chrome build does not support Kuma Picker's WebM recording profile.");
  }
  const recorder = new MediaRecorder(composedStream, { mimeType });
  const chunks = [];
  const startedAt = Date.now();

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", async () => {
    const blob = new Blob(chunks, {
      type: recorder.mimeType || mimeType || "video/webm",
    });

    try {
      await publishFinishedLiveCapture({
        recordingId,
        blob,
        preferredMimeType: blob.type || recorder.mimeType || mimeType || "video/webm",
        startedAt,
      });
    } finally {
      await cleanupLiveCapture(activeLiveCapture);
    }
  });

  recorder.start(1_000);
  activeLiveCapture = {
    id: recordingId,
    recorder,
    stream,
    canvasStream,
    video,
    audioPassthrough,
    fps,
    layoutPlan: normalizedLayoutPlan,
    renderFrameId: null,
  };
  renderLayoutPlanFrame(activeLiveCapture);

  return {
    recordingId,
    fps,
    mimeType: recorder.mimeType || mimeType || "video/webm",
    width: normalizedLayoutPlan.canvasWidth,
    height: normalizedLayoutPlan.canvasHeight,
  };
}

async function beginPreparedCapture(message) {
  const prepared = preparedLiveCapture;
  if (!prepared || prepared.id !== message?.recordingId) {
    throw new Error("No matching prepared live capture is available.");
  }

  const cropRect = normalizeCropRect(message?.cropRect, prepared.sourceWidth, prepared.sourceHeight);
  const result = await startCanvasComposedCapture({
    recordingId: prepared.id,
    stream: prepared.stream,
    video: prepared.video,
    fps: prepared.fps,
    captureKind: prepared.captureKind,
    layoutPlan: {
      canvasWidth: cropRect.width,
      canvasHeight: cropRect.height,
      backgroundColor: "#000000",
      sections: [
        {
          sourceRect: cropRect,
          targetRect: {
            x: 0,
            y: 0,
            width: cropRect.width,
            height: cropRect.height,
          },
        },
      ],
    },
  });
  preparedLiveCapture = null;
  return result;
}

async function startDirectStreamCapture(message) {
  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  const streamId = typeof message?.streamId === "string" ? message.streamId : "";
  if (!recordingId || !streamId) {
    throw new Error("Live capture start requires both a recording id and a stream id.");
  }

  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : DEFAULT_LIVE_CAPTURE_FPS;
  const captureKind = message?.captureKind === "screen" || message?.captureKind === "window" ? message.captureKind : "tab";
  const canRequestAudioTrack = message?.canRequestAudioTrack === true;
  const stream = await createCapturedStream(streamId, fps, captureKind, canRequestAudioTrack);
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => null);
  await waitForVideoReady(video);

  const mimeType = KumaPickerExtensionRecordingMedia.selectSupportedMimeType({
    includeAudio: stream.getAudioTracks().length > 0,
  });
  if (!mimeType) {
    throw new Error("This Chrome build does not support Kuma Picker's WebM recording profile.");
  }
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  const audioPassthrough = await createAudioPassthrough(stream, captureKind).catch(() => null);
  const startedAt = Date.now();

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", async () => {
    const blob = new Blob(chunks, {
      type: recorder.mimeType || mimeType || "video/webm",
    });

    try {
      await publishFinishedLiveCapture({
        recordingId,
        blob,
        preferredMimeType: blob.type || recorder.mimeType || mimeType || "video/webm",
        startedAt,
      });
    } finally {
      await cleanupLiveCapture(activeLiveCapture);
    }
  });

  recorder.start(1_000);
  activeLiveCapture = {
    id: recordingId,
    recorder,
    stream,
    video,
    audioPassthrough,
    fps,
    renderFrameId: null,
    canvasStream: null,
  };

  return {
    recordingId,
    fps,
    mimeType: recorder.mimeType || mimeType || "video/webm",
    width: Math.max(1, Math.round(video.videoWidth) || 1),
    height: Math.max(1, Math.round(video.videoHeight) || 1),
  };
}

async function startLiveCapture(message) {
  if (activeLiveCapture && activeLiveCapture.id !== message?.recordingId) {
    throw new Error("Another live capture is already active.");
  }

  if (typeof message?.preparedCaptureId === "string" && message.preparedCaptureId.trim()) {
    return beginPreparedCapture({
      recordingId: message.preparedCaptureId.trim(),
      cropRect: message?.cropRect ?? null,
    });
  }

  const captureKind = message?.captureKind === "screen" || message?.captureKind === "window" ? message.captureKind : "tab";
  const hasLayoutPlan = message?.layoutPlan && typeof message.layoutPlan === "object";
  if (!hasLayoutPlan) {
    return startDirectStreamCapture(message);
  }

  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  const streamId = typeof message?.streamId === "string" ? message.streamId : "";
  if (!recordingId || !streamId) {
    throw new Error("Live capture start requires both a recording id and a stream id.");
  }
  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : DEFAULT_LIVE_CAPTURE_FPS;
  const canRequestAudioTrack = message?.canRequestAudioTrack === true;
  const stream = await createCapturedStream(streamId, fps, captureKind, canRequestAudioTrack);
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => null);
  await waitForVideoReady(video);

  return startCanvasComposedCapture({
    recordingId,
    stream,
    video,
    fps,
    captureKind,
    layoutPlan: message.layoutPlan,
  });
}

function stopLiveCapture(message) {
  if (!activeLiveCapture || activeLiveCapture.id !== message?.recordingId) {
    throw new Error("No matching live capture is active.");
  }

  if (activeLiveCapture.recorder.state !== "inactive") {
    activeLiveCapture.recorder.stop();
  }

  return {
    recordingId: activeLiveCapture.id,
    stopping: true,
  };
}

async function discardPreparedCapture(message) {
  if (!preparedLiveCapture || preparedLiveCapture.id !== message?.recordingId) {
    return {
      recordingId: typeof message?.recordingId === "string" ? message.recordingId : "",
      discarded: false,
    };
  }

  const recordingId = preparedLiveCapture.id;
  await cleanupPreparedCapture(preparedLiveCapture);
  return {
    recordingId,
    discarded: true,
  };
}

function releaseDownloadUrl(message) {
  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  const downloadUrl = typeof message?.downloadUrl === "string" ? message.downloadUrl : "";

  return {
    recordingId,
    released: releasePendingDownloadUrl(recordingId, downloadUrl),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_LIVE_CAPTURE_TARGET) {
    return false;
  }

  void (async () => {
    try {
      switch (message?.type) {
        case "kuma-picker:live-capture-prepare":
          sendResponse({
            ok: true,
            result: await createPreparedCapture(message),
          });
          return;
        case "kuma-picker:live-capture-begin":
          sendResponse({
            ok: true,
            result: await beginPreparedCapture(message),
          });
          return;
        case "kuma-picker:live-capture-start":
          sendResponse({
            ok: true,
            result: await startLiveCapture(message),
          });
          return;
        case "kuma-picker:live-capture-discard":
          sendResponse({
            ok: true,
            result: await discardPreparedCapture(message),
          });
          return;
        case "kuma-picker:live-capture-stop":
          sendResponse({
            ok: true,
            result: stopLiveCapture(message),
          });
          return;
        case "kuma-picker:live-capture-release-download-url":
          sendResponse({
            ok: true,
            result: releaseDownloadUrl(message),
          });
          return;
        default:
          sendResponse({
            ok: false,
            error: `Unsupported live capture offscreen message: ${String(message?.type)}`,
          });
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});
