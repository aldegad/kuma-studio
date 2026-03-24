const OFFSCREEN_LIVE_CAPTURE_TARGET = "offscreen-live-capture";
const OFFSCREEN_LIVE_CAPTURE_PORT_NAME = "kuma-picker-live-capture";
const DEFAULT_LIVE_CAPTURE_FPS = 30;

const liveCapturePort = chrome.runtime.connect({ name: OFFSCREEN_LIVE_CAPTURE_PORT_NAME });

let activeLiveCapture = null;

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

async function createCapturedStream(streamId, fps) {
  const videoConstraints = {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
      maxFrameRate: Math.max(1, Math.min(60, Math.round(fps) || DEFAULT_LIVE_CAPTURE_FPS)),
    },
  };

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
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

async function createAudioPassthrough(stream) {
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
    recording?.stream?.getTracks?.().forEach((track) => track.stop());
  } finally {
    try {
      recording?.audioPassthrough?.source?.disconnect?.();
    } catch {}

    try {
      await recording?.audioPassthrough?.audioContext?.close?.();
    } catch {}

    activeLiveCapture = null;
  }
}

async function startLiveCapture(message) {
  if (activeLiveCapture && activeLiveCapture.id !== message?.recordingId) {
    throw new Error("Another live capture is already active.");
  }

  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  const streamId = typeof message?.streamId === "string" ? message.streamId : "";
  if (!recordingId || !streamId) {
    throw new Error("Live capture requires both a recording id and a stream id.");
  }

  const fps = Number.isFinite(message?.fps) ? Math.max(1, Math.min(60, Math.round(message.fps))) : DEFAULT_LIVE_CAPTURE_FPS;
  const stream = await createCapturedStream(streamId, fps);
  const audioPassthrough = await createAudioPassthrough(stream).catch(() => null);
  const mimeType = selectLiveCaptureMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks = [];

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
      const dataUrl = await blobToDataUrl(blob);
      await chrome.runtime.sendMessage({
        type: "kuma-picker:live-capture-finished",
        target: "service-worker",
        recordingId,
        dataUrl,
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
    stream,
    audioPassthrough,
    fps,
  };

  return {
    recordingId,
    fps,
    mimeType: recorder.mimeType || mimeType || "video/webm",
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_LIVE_CAPTURE_TARGET) {
    return false;
  }

  void (async () => {
    try {
      switch (message?.type) {
        case "kuma-picker:live-capture-start":
          sendResponse({
            ok: true,
            result: await startLiveCapture(message),
          });
          return;
        case "kuma-picker:live-capture-stop":
          sendResponse({
            ok: true,
            result: stopLiveCapture(message),
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
