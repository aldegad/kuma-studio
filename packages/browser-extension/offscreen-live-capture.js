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

function selectLiveCaptureMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function sanitizeDataUrlMimeType(mimeType) {
  const candidate = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  if (!candidate) {
    return "application/octet-stream";
  }

  return candidate.split(";")[0] || "application/octet-stream";
}

function waitForDelay(delayMs) {
  return new Promise((resolvePromise) => {
    window.setTimeout(resolvePromise, Math.max(0, delayMs));
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onerror = () => {
      rejectPromise(reader.error ?? new Error("Failed to read the live capture blob."));
    };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        rejectPromise(new Error("Failed to convert the live capture blob to a data URL."));
        return;
      }

      resolvePromise(reader.result);
    };
    reader.readAsDataURL(
      new Blob([blob], {
        type: sanitizeDataUrlMimeType(blob.type),
      }),
    );
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

  try {
    return await navigator.mediaDevices.getUserMedia({
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
  } catch (error) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    }).catch(() => {
      throw error;
    });
  }
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

function renderPreparedCaptureFrame(recording) {
  if (!recording) {
    return;
  }

  const { cropRect, sourceWidth, sourceHeight } = recording;
  liveCaptureContext.clearRect(0, 0, liveCaptureCanvas.width, liveCaptureCanvas.height);
  liveCaptureContext.drawImage(
    recording.video,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height,
    0,
    0,
    liveCaptureCanvas.width,
    liveCaptureCanvas.height,
  );
  recording.renderFrameId = requestAnimationFrame(() => {
    if (activeLiveCapture?.id === recording.id) {
      renderPreparedCaptureFrame(recording);
    }
  });
}

async function beginPreparedCapture(message) {
  const prepared = preparedLiveCapture;
  if (!prepared || prepared.id !== message?.recordingId) {
    throw new Error("No matching prepared live capture is available.");
  }

  const cropRect = normalizeCropRect(message?.cropRect, prepared.sourceWidth, prepared.sourceHeight);
  liveCaptureCanvas.width = cropRect.width;
  liveCaptureCanvas.height = cropRect.height;
  liveCaptureContext.clearRect(0, 0, liveCaptureCanvas.width, liveCaptureCanvas.height);
  liveCaptureContext.drawImage(
    prepared.video,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height,
    0,
    0,
    liveCaptureCanvas.width,
    liveCaptureCanvas.height,
  );

  const audioPassthrough = await createAudioPassthrough(prepared.stream, prepared.captureKind).catch(() => null);
  const canvasStream = liveCaptureCanvas.captureStream(prepared.fps);
  const composedTracks = [
    ...canvasStream.getVideoTracks(),
    ...prepared.stream.getAudioTracks(),
  ];
  const composedStream = new MediaStream(composedTracks);
  const mimeType = selectLiveCaptureMimeType();
  const recorder = mimeType ? new MediaRecorder(composedStream, { mimeType }) : new MediaRecorder(composedStream);
  const chunks = [];
  const recordingId = prepared.id;

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
      let downloadUrl = createBlobDownloadUrl(blob);
      let downloadUrlType = "object-url";
      if (downloadUrl) {
        pendingDownloadUrls.set(recordingId, downloadUrl);
      } else {
        downloadUrl = await blobToDataUrl(blob);
        downloadUrlType = "data-url";
      }

      await chrome.runtime.sendMessage({
        type: "kuma-picker:live-capture-finished",
        target: "service-worker",
        recordingId,
        downloadUrl,
        downloadUrlType,
        mimeType: blob.type || recorder.mimeType || mimeType || "video/webm",
        bytes: blob.size,
      });
    } finally {
      await cleanupLiveCapture(activeLiveCapture);
    }
  });

  recorder.start(1_000);
  activeLiveCapture = {
    id: recordingId,
    recorder,
    stream: prepared.stream,
    canvasStream,
    video: prepared.video,
    audioPassthrough,
    fps: prepared.fps,
    cropRect,
    sourceWidth: prepared.sourceWidth,
    sourceHeight: prepared.sourceHeight,
    renderFrameId: null,
  };
  preparedLiveCapture = null;
  renderPreparedCaptureFrame(activeLiveCapture);

  return {
    recordingId,
    fps: activeLiveCapture.fps,
    mimeType: recorder.mimeType || mimeType || "video/webm",
    width: cropRect.width,
    height: cropRect.height,
  };
}

async function startLiveCapture(message) {
  if (activeLiveCapture && activeLiveCapture.id !== message?.recordingId) {
    throw new Error("Another live capture is already active.");
  }

  const prepared = await createPreparedCapture(message);
  const started = await beginPreparedCapture({
    recordingId: prepared.recordingId,
    cropRect: null,
  });
  return {
    ...prepared,
    ...started,
  };
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
