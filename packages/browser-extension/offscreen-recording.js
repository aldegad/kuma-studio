const OFFSCREEN_RECORDING_TARGET = "offscreen-recording";
const KEEPALIVE_PORT_NAME = "kuma-picker-recording";
const DEFAULT_PLAYBACK_RECORDING_FPS = 30;
const MIN_RENDER_RECORDING_FPS = 10;

const canvas = document.getElementById("recording-canvas");
const context = canvas.getContext("2d", { alpha: false });
const keepalivePort = chrome.runtime.connect({ name: KEEPALIVE_PORT_NAME });

let activeRecording = null;

keepalivePort.onDisconnect.addListener(() => {});

function selectSupportedRecordingMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function clearRenderTimer(recording) {
  if (recording?.renderTimerId) {
    clearInterval(recording.renderTimerId);
    recording.renderTimerId = null;
  }
}

function renderRecordingFrame(recording) {
  if (!recording) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  if (recording.latestImage) {
    context.drawImage(recording.latestImage, 0, 0, canvas.width, canvas.height);
  }

  // Change a single pixel each tick so MediaRecorder advances even when the
  // source frame did not change.
  const markerColor = recording.renderTick % 2 === 0 ? "#000000" : "#010101";
  context.fillStyle = markerColor;
  context.fillRect(canvas.width - 1, canvas.height - 1, 1, 1);
  recording.renderTick += 1;
}

function waitForDelay(delayMs) {
  return new Promise((resolvePromise) => {
    window.setTimeout(resolvePromise, Math.max(0, delayMs));
  });
}

async function recordCanvasToBlob({ fps, renderLoop }) {
  const mimeType = selectSupportedRecordingMimeType();
  const stream = canvas.captureStream(fps);
  const chunks = [];
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const stopPromise = new Promise((resolvePromise) => {
    recorder.addEventListener("stop", () => {
      resolvePromise(
        new Blob(chunks, {
          type: recorder.mimeType || mimeType || "video/webm",
        }),
      );
    });
  });

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.start(1_000);

  try {
    await renderLoop();
  } finally {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  const blob = await stopPromise;
  stream.getTracks().forEach((track) => track.stop());
  return blob;
}

async function renderFrameSequenceToBlob({ frameDataUrls, width, height, fps }) {
  if (!Array.isArray(frameDataUrls) || frameDataUrls.length === 0) {
    throw new Error("Kuma Picker cannot accelerate a recording without captured frames.");
  }

  canvas.width = Math.max(1, Math.round(width) || canvas.width || 1);
  canvas.height = Math.max(1, Math.round(height) || canvas.height || 1);

  const outputFps = Math.max(1, Math.min(DEFAULT_PLAYBACK_RECORDING_FPS, Math.round(fps) || 1));
  const frameDurationMs = Math.max(33, Math.round(1_000 / outputFps));
  let renderTick = 0;

  return recordCanvasToBlob({
    fps: outputFps,
    renderLoop: async () => {
      for (const dataUrl of frameDataUrls) {
        await drawFrame(dataUrl);
        context.fillStyle = renderTick % 2 === 0 ? "#000000" : "#010101";
        context.fillRect(canvas.width - 1, canvas.height - 1, 1, 1);
        renderTick += 1;
        await waitForDelay(frameDurationMs);
      }

      // Give MediaRecorder one extra tick to flush the last painted frame.
      await waitForDelay(frameDurationMs);
    },
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onerror = () => {
      rejectPromise(reader.error ?? new Error("Failed to read the recorded video blob."));
    };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        rejectPromise(new Error("Failed to convert the recorded video blob to a data URL."));
        return;
      }

      resolvePromise(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

function drawFrame(dataUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    const image = new Image();
    image.onload = () => {
      if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolvePromise({
        width: canvas.width,
        height: canvas.height,
      });
    };
    image.onerror = () => {
      rejectPromise(new Error("Failed to decode a screenshot frame for recording."));
    };
    image.src = dataUrl;
  });
}

async function startRecording(message) {
  if (activeRecording && activeRecording.id !== message.recordingId) {
    throw new Error("Another recording is already active in the offscreen document.");
  }

  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  if (!recordingId) {
    throw new Error("The offscreen recorder requires a recording id.");
  }

  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(12, Math.round(message.fps))) : 2;
  const renderFps = Math.max(MIN_RENDER_RECORDING_FPS, fps);
  const width = Number.isFinite(message?.width) ? Math.max(1, Math.round(message.width)) : 1;
  const height = Number.isFinite(message?.height) ? Math.max(1, Math.round(message.height)) : 1;
  const mimeType = selectSupportedRecordingMimeType();
  const speedMultiplier =
    Number.isFinite(message?.speedMultiplier) && message.speedMultiplier > 0
      ? Math.max(0.25, Math.min(8, message.speedMultiplier))
      : 3;

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);

  const stream = canvas.captureStream(renderFps);
  const chunks = [];
  const startedAt = Date.now();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

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
      const capturedFrames = Array.isArray(activeRecording?.frameDataUrls) ? activeRecording.frameDataUrls.slice() : null;
      const finalBlob =
        speedMultiplier > 1 && capturedFrames?.length
          ? await renderFrameSequenceToBlob({
              frameDataUrls: capturedFrames,
              width: canvas.width,
              height: canvas.height,
              fps: Math.max(1, Math.round(fps * speedMultiplier)),
            })
          : blob;
      const dataUrl = await blobToDataUrl(finalBlob);
      await chrome.runtime.sendMessage({
        type: "kuma-picker:recording-finished",
        target: "service-worker",
        recordingId,
        dataUrl,
        mimeType: finalBlob.type || blob.type || recorder.mimeType || mimeType || "video/webm",
        bytes: finalBlob.size,
        width: canvas.width,
        height: canvas.height,
        frameCount: activeRecording?.frameCount ?? 0,
        renderedFrameCount: activeRecording?.renderedFrameCount ?? 0,
        durationMs: Date.now() - startedAt,
        speedMultiplier,
      });
    } finally {
      clearRenderTimer(activeRecording);
      activeRecording?.latestImage?.remove?.();
      stream.getTracks().forEach((track) => track.stop());
      activeRecording = null;
    }
  });

  recorder.start(1_000);
  activeRecording = {
    id: recordingId,
    recorder,
    frameCount: 0,
    renderedFrameCount: 0,
    renderTick: 0,
    renderTimerId: null,
    latestImage: null,
    frameDataUrls: speedMultiplier > 1 ? [] : null,
    speedMultiplier,
    startedAt,
  };
  renderRecordingFrame(activeRecording);
  activeRecording.renderedFrameCount += 1;
  activeRecording.renderTimerId = setInterval(() => {
    if (!activeRecording || activeRecording.id !== recordingId) {
      return;
    }

    renderRecordingFrame(activeRecording);
    activeRecording.renderedFrameCount += 1;
  }, Math.max(80, Math.round(1_000 / renderFps)));

  return {
    recordingId,
    fps,
    renderFps,
    speedMultiplier,
    mimeType: recorder.mimeType || mimeType || "video/webm",
    width,
    height,
  };
}

async function appendRecordingFrame(message) {
  if (!activeRecording || activeRecording.id !== message?.recordingId) {
    throw new Error("No matching offscreen recording is active for this frame.");
  }

  const dataUrl = typeof message?.dataUrl === "string" ? message.dataUrl : "";
  if (!dataUrl) {
    throw new Error("Recording frame data is required.");
  }

  const image = await new Promise((resolvePromise, rejectPromise) => {
    const nextImage = new Image();
    nextImage.onload = () => resolvePromise(nextImage);
    nextImage.onerror = () => rejectPromise(new Error("Failed to decode a screenshot frame for recording."));
    nextImage.src = dataUrl;
  });

  activeRecording.latestImage?.remove?.();
  activeRecording.latestImage = image;
  activeRecording.frameDataUrls?.push(dataUrl);
  const drawn = await drawFrame(dataUrl);
  activeRecording.frameCount += 1;

  return {
    recordingId: activeRecording.id,
    frameCount: activeRecording.frameCount,
    width: drawn.width,
    height: drawn.height,
  };
}

function stopRecording(message) {
  if (!activeRecording || activeRecording.id !== message?.recordingId) {
    throw new Error("No matching offscreen recording is active.");
  }

  clearRenderTimer(activeRecording);
  if (activeRecording.recorder.state !== "inactive") {
    activeRecording.recorder.stop();
  }

  return {
    recordingId: activeRecording.id,
    stopping: true,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_RECORDING_TARGET) {
    return false;
  }

  void (async () => {
    try {
      switch (message?.type) {
        case "kuma-picker:recording-start":
          sendResponse({
            ok: true,
            result: await startRecording(message),
          });
          return;
        case "kuma-picker:recording-frame":
          sendResponse({
            ok: true,
            result: await appendRecordingFrame(message),
          });
          return;
        case "kuma-picker:recording-stop":
          sendResponse({
            ok: true,
            result: stopRecording(message),
          });
          return;
        default:
          sendResponse({
            ok: false,
            error: `Unsupported offscreen recording message: ${String(message?.type)}`,
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
