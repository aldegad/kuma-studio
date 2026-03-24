const DEFAULT_FPS = 30;
const DEFAULT_INSET = 0.1;
const MIN_SELECTION_DISPLAY_SIZE = 18;
const COMPOSITION_SINGLE = "single";
const COMPOSITION_SPLIT = "split";
const SECTION_IDS = ["left", "right"];
const COMPOSITE_PADDING = 24;
const COMPOSITE_GAP = 28;
const MAX_COMPOSITE_EDGE = 3840;

const SECTION_LABELS = {
  single: "Frame",
  left: "Left",
  right: "Right",
};

const studioTitleElement = document.getElementById("studio-title");
const studioSubtitleElement = document.getElementById("studio-subtitle");
const chooseSourceButton = document.getElementById("choose-source");
const startRecordingButton = document.getElementById("start-recording");
const stopRecordingButton = document.getElementById("stop-recording");
const closeStudioButton = document.getElementById("close-studio");
const useFullFrameButton = document.getElementById("use-full-frame");
const previewStageElement = document.getElementById("preview-stage");
const previewVideoElement = document.getElementById("preview-video");
const previewEmptyElement = document.getElementById("preview-empty");
const selectionOverlaysElement = document.getElementById("selection-overlays");
const previewScaleElement = document.getElementById("preview-scale");
const previewScaleValueElement = document.getElementById("preview-scale-value");
const statusLineElement = document.getElementById("status-line");
const statusMetaElement = document.getElementById("status-meta");
const studioHintElement = document.getElementById("studio-hint");
const captureKindChipElement = document.getElementById("capture-kind-chip");
const compositionChipElement = document.getElementById("composition-chip");
const captureSizeChipElement = document.getElementById("capture-size-chip");
const layoutSingleButton = document.getElementById("layout-single");
const layoutSplitButton = document.getElementById("layout-split");
const resetCompositionButton = document.getElementById("reset-composition");
const sectionControlsElement = document.getElementById("section-controls");
const sectionButtonElements = Array.from(document.querySelectorAll("[data-section-button]"));
const recordingCanvas = document.getElementById("recording-canvas");
const recordingContext = recordingCanvas.getContext("2d", { alpha: false });

const url = new URL(window.location.href);
const studioId = url.searchParams.get("studioId") || "";

let studioContext = null;
let sourceStream = null;
let selectionRects = {
  single: null,
  left: null,
  right: null,
};
let compositionMode = COMPOSITION_SINGLE;
let activeSectionId = COMPOSITION_SINGLE;
let selectionDrag = null;
let recorder = null;
let recorderMimeType = "";
let recordingPlan = null;
let chunks = [];
let recordingActive = false;
let stopping = false;
let renderFrameId = null;
const pendingDownloadUrls = new Map();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCompositionLabel() {
  return compositionMode === COMPOSITION_SPLIT ? "2-Up" : "Single";
}

function getVisibleSectionIds() {
  return compositionMode === COMPOSITION_SPLIT ? SECTION_IDS : [COMPOSITION_SINGLE];
}

function getActiveSectionId() {
  return compositionMode === COMPOSITION_SPLIT ? activeSectionId : COMPOSITION_SINGLE;
}

function hasRecordingSelection() {
  if (compositionMode === COMPOSITION_SPLIT) {
    return Boolean(selectionRects.left && selectionRects.right);
  }

  return Boolean(selectionRects.single);
}

function setPreviewScale(percent) {
  const normalized = clamp(Number(percent) || 100, 80, 145);
  previewStageElement.style.setProperty("--preview-scale", String(normalized / 100));
  previewScaleValueElement.textContent = `${normalized}%`;
  window.requestAnimationFrame(() => {
    renderSelectionBoxes();
  });
}

function setStatus(line, meta = "") {
  statusLineElement.textContent = line;
  statusMetaElement.textContent = meta;
}

function updateButtonState() {
  const layoutButtonsDisabled = stopping || recordingActive;
  chooseSourceButton.disabled = layoutButtonsDisabled;
  useFullFrameButton.disabled = layoutButtonsDisabled || !sourceStream;
  resetCompositionButton.disabled = layoutButtonsDisabled || !sourceStream;
  startRecordingButton.disabled = layoutButtonsDisabled || !sourceStream || !hasRecordingSelection();
  stopRecordingButton.disabled = !recordingActive && !stopping;
  layoutSingleButton.disabled = layoutButtonsDisabled;
  layoutSplitButton.disabled = layoutButtonsDisabled;
  sectionButtonElements.forEach((button) => {
    button.disabled = layoutButtonsDisabled || compositionMode !== COMPOSITION_SPLIT;
  });
}

function updateCompositionUi() {
  compositionChipElement.textContent = getCompositionLabel();
  layoutSingleButton.classList.toggle("is-active", compositionMode === COMPOSITION_SINGLE);
  layoutSplitButton.classList.toggle("is-active", compositionMode === COMPOSITION_SPLIT);
  sectionControlsElement.classList.toggle("is-hidden", compositionMode !== COMPOSITION_SPLIT);
  sectionButtonElements.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sectionButton === activeSectionId);
  });
  useFullFrameButton.textContent = compositionMode === COMPOSITION_SPLIT ? "좌우 반반으로 재설정" : "전체 프레임 사용";
  startRecordingButton.textContent = compositionMode === COMPOSITION_SPLIT ? "2-Up 녹화 시작" : "선택 영역 녹화 시작";
  studioHintElement.textContent =
    compositionMode === COMPOSITION_SPLIT
      ? "`2-Up` 모드에서는 Left와 Right를 각각 드래그해 한 화면짜리 영상으로 합칩니다."
      : "`공유 대상 고르기`를 누르면 크롬의 공유 선택창이 열리고, 프리뷰에서 한 번 드래그해 프레임을 정할 수 있어요.";
  updateButtonState();
}

function applyStudioCopy() {
  if (!studioContext) {
    return;
  }

  const label = studioContext.captureLabel || "Screen";
  studioTitleElement.textContent = `${label}을 예쁘게 프레이밍해볼까요?`;
  studioSubtitleElement.textContent =
    label === "Window"
      ? "창을 공유한 뒤, 필요한 부분만 드래그해서 깔끔하게 잘라서 녹화하거나 2-up으로 합칠 수 있어요."
      : "화면을 공유한 뒤, 필요한 부분만 드래그해서 보기 좋게 잘라서 녹화하거나 2-up으로 합칠 수 있어요.";
  captureKindChipElement.textContent = label;
  updateCompositionUi();
  setStatus("공유 대기 중", `${label} 공유를 시작하면 여기에서 실시간 프리뷰가 열립니다.`);
}

function clearSelectionBoxes() {
  selectionOverlaysElement.replaceChildren();
}

function getPreviewBounds() {
  return previewVideoElement.getBoundingClientRect();
}

function normalizeSelectionRect(rect) {
  if (!studioContext || !rect) {
    return null;
  }

  const maxX = Math.max(0, studioContext.sourceWidth - 1);
  const maxY = Math.max(0, studioContext.sourceHeight - 1);
  const x = clamp(Math.round(rect.x), 0, maxX);
  const y = clamp(Math.round(rect.y), 0, maxY);
  const maxWidth = Math.max(1, studioContext.sourceWidth - x);
  const maxHeight = Math.max(1, studioContext.sourceHeight - y);

  return {
    x,
    y,
    width: clamp(Math.round(rect.width), 1, maxWidth),
    height: clamp(Math.round(rect.height), 1, maxHeight),
  };
}

function createInsetSelectionRect() {
  if (!studioContext) {
    return null;
  }

  const insetX = Math.round(studioContext.sourceWidth * DEFAULT_INSET);
  const insetY = Math.round(studioContext.sourceHeight * DEFAULT_INSET);
  return normalizeSelectionRect({
    x: insetX,
    y: insetY,
    width: Math.max(1, studioContext.sourceWidth - insetX * 2),
    height: Math.max(1, studioContext.sourceHeight - insetY * 2),
  });
}

function createSplitSelectionRects() {
  if (!studioContext) {
    return {
      left: null,
      right: null,
    };
  }

  const insetX = Math.round(studioContext.sourceWidth * Math.max(0.06, DEFAULT_INSET * 0.75));
  const insetY = Math.round(studioContext.sourceHeight * DEFAULT_INSET);
  const centerGap = Math.max(24, Math.round(studioContext.sourceWidth * 0.035));
  const availableWidth = Math.max(2, studioContext.sourceWidth - insetX * 2 - centerGap);
  const leftWidth = Math.max(1, Math.floor(availableWidth / 2));
  const rightX = insetX + leftWidth + centerGap;

  return {
    left: normalizeSelectionRect({
      x: insetX,
      y: insetY,
      width: leftWidth,
      height: Math.max(1, studioContext.sourceHeight - insetY * 2),
    }),
    right: normalizeSelectionRect({
      x: rightX,
      y: insetY,
      width: Math.max(1, studioContext.sourceWidth - insetX - rightX),
      height: Math.max(1, studioContext.sourceHeight - insetY * 2),
    }),
  };
}

function applyDefaultSelections() {
  if (!studioContext) {
    return;
  }

  if (compositionMode === COMPOSITION_SPLIT) {
    const splitRects = createSplitSelectionRects();
    selectionRects = {
      ...selectionRects,
      left: splitRects.left,
      right: splitRects.right,
    };
    activeSectionId = activeSectionId === "right" ? "right" : "left";
  } else {
    selectionRects = {
      ...selectionRects,
      single: createInsetSelectionRect(),
    };
    activeSectionId = COMPOSITION_SINGLE;
  }

  renderSelectionBoxes();
  updateButtonState();
}

function setSelectionRect(sectionId, rect) {
  if (!rect) {
    selectionRects[sectionId] = null;
  } else {
    selectionRects[sectionId] = normalizeSelectionRect(rect);
  }

  renderSelectionBoxes();
  updateButtonState();
}

function setCompositionMode(mode) {
  const normalizedMode = mode === COMPOSITION_SPLIT ? COMPOSITION_SPLIT : COMPOSITION_SINGLE;
  if (compositionMode === normalizedMode) {
    return;
  }

  compositionMode = normalizedMode;
  activeSectionId = compositionMode === COMPOSITION_SPLIT ? "left" : COMPOSITION_SINGLE;
  if (sourceStream) {
    applyDefaultSelections();
    setStatus(
      compositionMode === COMPOSITION_SPLIT ? "2-Up 프레이밍 준비 완료" : "프레이밍 준비 완료",
      compositionMode === COMPOSITION_SPLIT
        ? "Left와 Right를 각각 드래그해서 한 화면짜리 영상으로 합쳐보세요."
        : "마우스로 원하는 영역을 드래그한 다음 녹화를 시작하세요.",
    );
  } else {
    renderSelectionBoxes();
    updateButtonState();
  }
  updateCompositionUi();
}

function setActiveSection(sectionId) {
  if (compositionMode !== COMPOSITION_SPLIT || (sectionId !== "left" && sectionId !== "right")) {
    return;
  }

  activeSectionId = sectionId;
  renderSelectionBoxes();
  updateCompositionUi();
}

function renderSelectionBoxes() {
  if (!studioContext || !sourceStream) {
    clearSelectionBoxes();
    return;
  }

  const bounds = getPreviewBounds();
  if (bounds.width < 1 || bounds.height < 1) {
    clearSelectionBoxes();
    return;
  }

  const scaleX = bounds.width / studioContext.sourceWidth;
  const scaleY = bounds.height / studioContext.sourceHeight;
  selectionOverlaysElement.replaceChildren();

  for (const sectionId of getVisibleSectionIds()) {
    const rect = selectionRects[sectionId];
    if (!rect) {
      continue;
    }

    const box = document.createElement("div");
    box.className = "selection-box";
    box.dataset.section = sectionId;
    if (sectionId === getActiveSectionId()) {
      box.classList.add("is-active");
    }
    box.style.left = `${Math.round(rect.x * scaleX)}px`;
    box.style.top = `${Math.round(rect.y * scaleY)}px`;
    box.style.width = `${Math.max(1, Math.round(rect.width * scaleX))}px`;
    box.style.height = `${Math.max(1, Math.round(rect.height * scaleY))}px`;

    const header = document.createElement("div");
    header.className = "selection-header";
    const label = document.createElement("span");
    label.className = "selection-label";
    label.textContent = SECTION_LABELS[sectionId];
    header.append(label);

    const size = document.createElement("span");
    size.className = "selection-size";
    size.textContent = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;

    box.append(header, size);
    selectionOverlaysElement.append(box);
  }
}

function getSelectionFromPoints(startPoint, currentPoint) {
  if (!studioContext) {
    return null;
  }

  const bounds = getPreviewBounds();
  if (bounds.width < 1 || bounds.height < 1) {
    return null;
  }

  const startX = clamp(startPoint.x - bounds.x, 0, bounds.width);
  const startY = clamp(startPoint.y - bounds.y, 0, bounds.height);
  const currentX = clamp(currentPoint.x - bounds.x, 0, bounds.width);
  const currentY = clamp(currentPoint.y - bounds.y, 0, bounds.height);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  if (width < MIN_SELECTION_DISPLAY_SIZE || height < MIN_SELECTION_DISPLAY_SIZE) {
    return null;
  }

  return {
    x: (Math.min(startX, currentX) / bounds.width) * studioContext.sourceWidth,
    y: (Math.min(startY, currentY) / bounds.height) * studioContext.sourceHeight,
    width: (width / bounds.width) * studioContext.sourceWidth,
    height: (height / bounds.height) * studioContext.sourceHeight,
  };
}

function waitForVideoReady(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("공유된 화면을 여는 데 시간이 너무 오래 걸렸어요."));
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
      rejectPromise(new Error("공유된 화면 프리뷰를 열지 못했어요."));
    }

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
  });
}

async function createStreamFromDesktopCapture(streamId, canRequestAudioTrack) {
  const constraints = {
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
      },
    },
    audio: canRequestAudioTrack
      ? {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: streamId,
          },
        }
      : false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    return navigator.mediaDevices.getUserMedia({
      ...constraints,
      audio: false,
    }).catch(() => {
      throw error;
    });
  }
}

function chooseDesktopSource() {
  if (!studioContext) {
    return Promise.reject(new Error("Capture Studio context is not ready."));
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const sources = [studioContext.captureKind === "window" ? "window" : "screen", "audio"];
    chrome.desktopCapture.chooseDesktopMedia(sources, async (streamId, options = {}) => {
      if (!streamId) {
        rejectPromise(new Error(`${studioContext.captureLabel} 공유가 취소되었어요.`));
        return;
      }

      try {
        const stream = await createStreamFromDesktopCapture(streamId, options.canRequestAudioTrack === true);
        resolvePromise(stream);
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function stopSourceStream() {
  sourceStream?.getTracks?.().forEach((track) => track.stop());
  sourceStream = null;
  previewVideoElement.srcObject = null;
}

async function preparePreview() {
  setStatus("공유 선택창을 여는 중...", `${studioContext.captureLabel}을 하나 고른 뒤 공유를 눌러주세요.`);
  const stream = await chooseDesktopSource();
  stopSourceStream();
  sourceStream = stream;
  previewVideoElement.srcObject = stream;
  previewVideoElement.muted = true;
  previewEmptyElement.classList.add("is-hidden");
  await previewVideoElement.play().catch(() => null);
  await waitForVideoReady(previewVideoElement);
  studioContext.sourceWidth = previewVideoElement.videoWidth;
  studioContext.sourceHeight = previewVideoElement.videoHeight;
  captureSizeChipElement.textContent = `${studioContext.sourceWidth} x ${studioContext.sourceHeight}`;
  applyDefaultSelections();
  setStatus(
    compositionMode === COMPOSITION_SPLIT ? "2-Up 프레이밍 준비 완료" : "프레이밍 준비 완료",
    compositionMode === COMPOSITION_SPLIT
      ? "Left와 Right를 각각 드래그해서 하나의 영상으로 합쳐보세요."
      : "마우스로 원하는 영역을 드래그한 다음 녹화를 시작하세요.",
  );
}

function scaleRect(rect, factor) {
  return {
    x: Math.round(rect.x * factor),
    y: Math.round(rect.y * factor),
    width: Math.max(1, Math.round(rect.width * factor)),
    height: Math.max(1, Math.round(rect.height * factor)),
  };
}

function buildSingleRecordingPlan() {
  const rect = selectionRects.single ?? createInsetSelectionRect();
  if (!rect) {
    throw new Error("먼저 프리뷰에서 녹화할 영역을 잡아주세요.");
  }

  return {
    mode: COMPOSITION_SINGLE,
    canvasWidth: Math.max(1, Math.round(rect.width)),
    canvasHeight: Math.max(1, Math.round(rect.height)),
    sections: [
      {
        id: COMPOSITION_SINGLE,
        sourceRect: rect,
        targetRect: {
          x: 0,
          y: 0,
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
      },
    ],
  };
}

function buildSplitRecordingPlan() {
  const leftRect = selectionRects.left;
  const rightRect = selectionRects.right;
  if (!leftRect || !rightRect) {
    throw new Error("2-Up 녹화는 Left와 Right 영역을 둘 다 잡아야 시작할 수 있어요.");
  }

  const sourceRects = [
    { id: "left", rect: leftRect },
    { id: "right", rect: rightRect },
  ];
  const targetHeight = Math.max(leftRect.height, rightRect.height);
  let cursorX = COMPOSITE_PADDING;
  let totalWidth = COMPOSITE_PADDING * 2 + COMPOSITE_GAP;
  const sections = sourceRects.map(({ id, rect }, index) => {
    const scale = targetHeight / rect.height;
    const targetWidth = Math.max(1, Math.round(rect.width * scale));
    const targetRect = {
      x: cursorX,
      y: COMPOSITE_PADDING,
      width: targetWidth,
      height: targetHeight,
    };
    cursorX += targetWidth + (index < sourceRects.length - 1 ? COMPOSITE_GAP : 0);
    totalWidth += targetWidth;
    return {
      id,
      sourceRect: rect,
      targetRect,
    };
  });
  const totalHeight = COMPOSITE_PADDING * 2 + targetHeight;
  const edgeScale = Math.min(1, MAX_COMPOSITE_EDGE / Math.max(totalWidth, totalHeight));

  return {
    mode: COMPOSITION_SPLIT,
    canvasWidth: Math.max(1, Math.round(totalWidth * edgeScale)),
    canvasHeight: Math.max(1, Math.round(totalHeight * edgeScale)),
    sections: sections.map((section) => ({
      ...section,
      targetRect: scaleRect(section.targetRect, edgeScale),
    })),
  };
}

function createRecordingPlan() {
  return compositionMode === COMPOSITION_SPLIT ? buildSplitRecordingPlan() : buildSingleRecordingPlan();
}

function drawRecordingFrame() {
  if (!recordingActive || !recordingPlan) {
    return;
  }

  recordingContext.fillStyle = recordingPlan.mode === COMPOSITION_SPLIT ? "#0b1220" : "#000000";
  recordingContext.fillRect(0, 0, recordingCanvas.width, recordingCanvas.height);

  for (const section of recordingPlan.sections) {
    recordingContext.drawImage(
      previewVideoElement,
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

  renderFrameId = requestAnimationFrame(drawRecordingFrame);
}

function selectMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function blobToDataUrl(blob) {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onerror = () => {
      rejectPromise(reader.error ?? new Error("녹화 데이터를 읽지 못했어요."));
    };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        rejectPromise(new Error("녹화 데이터를 변환하지 못했어요."));
        return;
      }

      resolvePromise(reader.result);
    };
    reader.readAsDataURL(blob);
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

async function startRecording() {
  if (!studioContext || !sourceStream || recordingActive) {
    return;
  }

  recordingPlan = createRecordingPlan();
  recordingCanvas.width = recordingPlan.canvasWidth;
  recordingCanvas.height = recordingPlan.canvasHeight;
  const canvasStream = recordingCanvas.captureStream(studioContext.fps || DEFAULT_FPS);
  const composedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...sourceStream.getAudioTracks(),
  ]);
  recorderMimeType = selectMimeType();
  recorder = recorderMimeType ? new MediaRecorder(composedStream, { mimeType: recorderMimeType }) : new MediaRecorder(composedStream);
  chunks = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", async () => {
    const blob = new Blob(chunks, {
      type: recorder.mimeType || recorderMimeType || "video/webm",
    });
    let downloadUrl = createBlobDownloadUrl(blob);
    let downloadUrlType = "object-url";
    if (downloadUrl) {
      pendingDownloadUrls.set(studioContext.id, downloadUrl);
    } else {
      downloadUrl = await blobToDataUrl(blob);
      downloadUrlType = "data-url";
    }

    await chrome.runtime.sendMessage({
      type: "kuma-picker:live-capture-finished",
      target: "service-worker",
      recordingId: studioContext.id,
      downloadUrl,
      downloadUrlType,
      mimeType: blob.type || recorder.mimeType || recorderMimeType || "video/webm",
      bytes: blob.size,
    });
    canvasStream.getTracks().forEach((track) => track.stop());
    recordingActive = false;
    stopping = false;
    recordingPlan = null;
    if (renderFrameId) {
      cancelAnimationFrame(renderFrameId);
      renderFrameId = null;
    }
    updateButtonState();
  });

  const startResponse = await chrome.runtime.sendMessage({
    type: "kuma-picker:studio-live-capture-started",
    studioId: studioContext.id,
    startedAt: new Date().toISOString(),
    compositionMode,
  });
  if (!startResponse?.ok) {
    throw new Error(startResponse?.error || "Capture Studio could not register the recording session.");
  }

  recordingActive = true;
  stopping = false;
  updateButtonState();
  setStatus(
    compositionMode === COMPOSITION_SPLIT ? "2-Up 녹화 중" : "녹화 중",
    compositionMode === COMPOSITION_SPLIT
      ? "선택한 Left/Right 영역을 하나의 영상으로 합성해서 기록하고 있어요."
      : "팝업이나 터미널에서도 이 녹화를 종료할 수 있어요.",
  );
  drawRecordingFrame();
  recorder.start(1_000);
}

function requestStopRecordingFromStudio() {
  if (!recordingActive || stopping) {
    return Promise.resolve();
  }

  stopping = true;
  updateButtonState();
  setStatus("녹화를 정리하는 중...", "완료되면 Downloads 폴더로 저장됩니다.");
  return chrome.runtime.sendMessage({
    type: "kuma-picker:stop-live-capture",
  });
}

function stopRecordingLocally() {
  if (!recorder || recorder.state === "inactive") {
    return;
  }

  stopping = true;
  updateButtonState();
  recorder.stop();
}

async function loadStudioContext() {
  const response = await chrome.runtime.sendMessage({
    type: "kuma-picker:get-live-capture-studio-context",
    studioId,
  });
  if (!response?.ok || !response.studio) {
    throw new Error(response?.error || "Capture Studio context is unavailable.");
  }

  studioContext = response.studio;
  applyStudioCopy();
  updateButtonState();
}

chooseSourceButton.addEventListener("click", async () => {
  try {
    await preparePreview();
  } catch (error) {
    setStatus("공유를 시작하지 못했어요", error instanceof Error ? error.message : String(error));
  }
});

useFullFrameButton.addEventListener("click", () => {
  if (!sourceStream) {
    return;
  }

  if (compositionMode === COMPOSITION_SPLIT) {
    applyDefaultSelections();
    setStatus("2-Up 기본 구도로 재설정했어요", "좌우를 각각 다시 드래그해서 원하는 구성으로 맞춰보세요.");
    return;
  }

  selectionRects.single = normalizeSelectionRect({
    x: 0,
    y: 0,
    width: studioContext.sourceWidth,
    height: studioContext.sourceHeight,
  });
  renderSelectionBoxes();
  updateButtonState();
  setStatus("전체 프레임 사용", "전체 공유 화면을 그대로 녹화합니다.");
});

resetCompositionButton.addEventListener("click", () => {
  if (!sourceStream) {
    return;
  }

  applyDefaultSelections();
  setStatus(
    compositionMode === COMPOSITION_SPLIT ? "2-Up 기본 구도로 재설정했어요" : "기본 프레임으로 되돌렸어요",
    compositionMode === COMPOSITION_SPLIT
      ? "Left와 Right를 각각 다시 드래그해서 원하는 구성으로 맞춰보세요."
      : "프레임을 다시 드래그해 원하는 영역을 잡아보세요.",
  );
});

layoutSingleButton.addEventListener("click", () => {
  setCompositionMode(COMPOSITION_SINGLE);
});

layoutSplitButton.addEventListener("click", () => {
  setCompositionMode(COMPOSITION_SPLIT);
});

sectionButtonElements.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveSection(button.dataset.sectionButton);
  });
});

startRecordingButton.addEventListener("click", async () => {
  try {
    await startRecording();
  } catch (error) {
    setStatus("녹화를 시작하지 못했어요", error instanceof Error ? error.message : String(error));
  }
});

stopRecordingButton.addEventListener("click", async () => {
  try {
    const result = await requestStopRecordingFromStudio();
    if (result?.ok) {
      setStatus("녹화가 저장되었어요", "Downloads 폴더에서 바로 확인할 수 있어요.");
      window.setTimeout(() => window.close(), 700);
    }
  } catch (error) {
    setStatus("녹화 종료에 실패했어요", error instanceof Error ? error.message : String(error));
  }
});

closeStudioButton.addEventListener("click", () => {
  window.close();
});

previewStageElement.addEventListener("pointerdown", (event) => {
  if (!sourceStream || recordingActive || event.button !== 0) {
    return;
  }

  selectionDrag = {
    sectionId: getActiveSectionId(),
    x: event.clientX,
    y: event.clientY,
  };
  previewStageElement.setPointerCapture(event.pointerId);
  const nextSelection = getSelectionFromPoints(selectionDrag, { x: event.clientX, y: event.clientY });
  if (nextSelection) {
    setSelectionRect(selectionDrag.sectionId, nextSelection);
  }
});

previewStageElement.addEventListener("pointermove", (event) => {
  if (!selectionDrag || recordingActive) {
    return;
  }

  const nextSelection = getSelectionFromPoints(selectionDrag, { x: event.clientX, y: event.clientY });
  if (nextSelection) {
    setSelectionRect(selectionDrag.sectionId, nextSelection);
  }
});

previewStageElement.addEventListener("pointerup", (event) => {
  if (!selectionDrag) {
    return;
  }

  previewStageElement.releasePointerCapture(event.pointerId);
  selectionDrag = null;
});

previewStageElement.addEventListener("pointercancel", () => {
  selectionDrag = null;
});

previewScaleElement.addEventListener("input", (event) => {
  setPreviewScale(event.currentTarget?.value);
});

window.addEventListener("resize", () => {
  renderSelectionBoxes();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "capture-studio") {
    return false;
  }

  if (message?.type === "kuma-picker:studio-live-capture-stop-request" && message.recordingId === studioContext?.id) {
    stopRecordingLocally();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "kuma-picker:studio-live-capture-release-download-url" && message.recordingId === studioContext?.id) {
    sendResponse({
      ok: true,
      released: releasePendingDownloadUrl(message.recordingId, typeof message?.downloadUrl === "string" ? message.downloadUrl : ""),
    });
    return false;
  }

  sendResponse({ ok: false, error: `Unsupported Capture Studio message: ${String(message?.type)}` });
  return false;
});

window.addEventListener("beforeunload", () => {
  if (renderFrameId) {
    cancelAnimationFrame(renderFrameId);
  }
  stopSourceStream();
});

setPreviewScale(previewScaleElement.value);

void loadStudioContext().catch((error) => {
  setStatus("Capture Studio를 열지 못했어요", error instanceof Error ? error.message : String(error));
});
