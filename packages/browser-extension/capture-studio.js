const DEFAULT_FPS = 30;
const DEFAULT_INSET = 0.1;
const MIN_SELECTION_DISPLAY_SIZE = 18;
const PREVIEW_RENDER_MAX_EDGE = 960;
const COMPOSITION_SINGLE = "single";
const COMPOSITION_SPLIT = "split";
const SECTION_IDS = ["left", "right"];
const COMPOSITE_PADDING = 10;
const COMPOSITE_GAP = 10;
const MAX_COMPOSITE_EDGE = 3840;
const HANDLE_DEFINITIONS = [
  { id: "nw", x: "0%", y: "0%" },
  { id: "n", x: "50%", y: "0%" },
  { id: "ne", x: "100%", y: "0%" },
  { id: "w", x: "0%", y: "50%" },
  { id: "move", x: "50%", y: "50%" },
  { id: "e", x: "100%", y: "50%" },
  { id: "sw", x: "0%", y: "100%" },
  { id: "s", x: "50%", y: "100%" },
  { id: "se", x: "100%", y: "100%" },
];

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
const compositeSizeChipElement = document.getElementById("composite-size-chip");
const compositePreviewCanvas = document.getElementById("composite-preview-canvas");
const compositePreviewContext = compositePreviewCanvas.getContext("2d", { alpha: false });
const compositePreviewEmptyElement = document.getElementById("composite-preview-empty");
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
let renderLoopId = null;
const pendingDownloadUrls = new Map();
let storedStudioPreferences = KumaPickerExtensionLiveCaptureSettings.createDefaultStudioSettings();

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

function getCompositeFillColor(mode) {
  return mode === COMPOSITION_SPLIT ? "#060a12" : "#000000";
}

function rectToRatioRect(rect) {
  if (!studioContext || !rect) {
    return null;
  }

  return {
    x: rect.x / studioContext.sourceWidth,
    y: rect.y / studioContext.sourceHeight,
    width: rect.width / studioContext.sourceWidth,
    height: rect.height / studioContext.sourceHeight,
  };
}

function ratioRectToSelectionRect(ratioRect) {
  if (!studioContext || !ratioRect) {
    return null;
  }

  return normalizeSelectionRect({
    x: ratioRect.x * studioContext.sourceWidth,
    y: ratioRect.y * studioContext.sourceHeight,
    width: ratioRect.width * studioContext.sourceWidth,
    height: ratioRect.height * studioContext.sourceHeight,
  });
}

function createStudioPreferenceSnapshot() {
  return {
    previewScalePercent: clamp(Math.round(Number(previewScaleElement.value) || 100), 80, 145),
    compositionMode,
    activeSectionId: getActiveSectionId(),
    selectionRatios: {
      single: rectToRatioRect(selectionRects.single),
      left: rectToRatioRect(selectionRects.left),
      right: rectToRatioRect(selectionRects.right),
    },
  };
}

async function persistStudioPreferences() {
  if (!studioContext || (studioContext.captureKind !== "window" && studioContext.captureKind !== "screen")) {
    return;
  }

  storedStudioPreferences = await KumaPickerExtensionLiveCaptureSettings.writeStudioPreferences(
    studioContext.captureKind,
    createStudioPreferenceSnapshot(),
  );
}

function applyStoredSelections() {
  if (!studioContext) {
    return false;
  }

  if (compositionMode === COMPOSITION_SPLIT) {
    const left = ratioRectToSelectionRect(storedStudioPreferences.selectionRatios.left);
    const right = ratioRectToSelectionRect(storedStudioPreferences.selectionRatios.right);
    if (!left || !right) {
      return false;
    }

    selectionRects = {
      ...selectionRects,
      left,
      right,
    };
    activeSectionId = storedStudioPreferences.activeSectionId === "right" ? "right" : "left";
    return true;
  }

  const single = ratioRectToSelectionRect(storedStudioPreferences.selectionRatios.single);
  if (!single) {
    return false;
  }

  selectionRects = {
    ...selectionRects,
    single,
  };
  activeSectionId = COMPOSITION_SINGLE;
  return true;
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
  useFullFrameButton.textContent = compositionMode === COMPOSITION_SPLIT ? "Reset Split Layout" : "Use Full Frame";
  startRecordingButton.textContent = compositionMode === COMPOSITION_SPLIT ? "Start 2-Up Recording" : "Start Recording Selection";
  studioHintElement.textContent =
    compositionMode === COMPOSITION_SPLIT
      ? "In 2-Up mode, drag or resize the Left and Right sections to combine them into a single video."
      : "Click Choose Source to open Chrome's share picker, then drag or resize the frame in the preview.";
  updateButtonState();
}

function applyStudioCopy() {
  if (!studioContext) {
    return;
  }

  const label = studioContext.captureLabel || "Screen";
  studioTitleElement.textContent = `Frame your ${label}`;
  studioSubtitleElement.textContent =
    label === "Window"
      ? "Share a window, then drag or resize to crop it cleanly or combine sections in 2-Up mode."
      : "Share your screen, then drag or resize to crop it neatly or combine sections in 2-Up mode.";
  captureKindChipElement.textContent = label;
  updateCompositionUi();
  setStatus("Waiting for share", `Start sharing ${label}, and a live preview will appear here.`);
}

function clearSelectionBoxes() {
  selectionOverlaysElement.replaceChildren();
}

function clearCompositePreview() {
  compositePreviewContext.fillStyle = "#09111c";
  compositePreviewContext.fillRect(0, 0, compositePreviewCanvas.width, compositePreviewCanvas.height);
  compositePreviewEmptyElement.classList.remove("is-hidden");
  compositeSizeChipElement.textContent = "Waiting";
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

function getMinimumSelectionSize() {
  if (!studioContext) {
    return {
      width: 1,
      height: 1,
    };
  }

  const bounds = getPreviewBounds();
  if (bounds.width < 1 || bounds.height < 1) {
    return {
      width: 1,
      height: 1,
    };
  }

  return {
    width: Math.max(1, (MIN_SELECTION_DISPLAY_SIZE / bounds.width) * studioContext.sourceWidth),
    height: Math.max(1, (MIN_SELECTION_DISPLAY_SIZE / bounds.height) * studioContext.sourceHeight),
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

  const insetX = Math.round(studioContext.sourceWidth * Math.max(0.05, DEFAULT_INSET * 0.6));
  const insetY = Math.round(studioContext.sourceHeight * DEFAULT_INSET);
  const centerGap = Math.max(12, Math.round(studioContext.sourceWidth * 0.014));
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

function applyDefaultSelections(options = {}) {
  if (!studioContext) {
    return;
  }

  if (options.useStored !== false && applyStoredSelections()) {
    renderSelectionBoxes();
    updateButtonState();
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
      compositionMode === COMPOSITION_SPLIT ? "2-Up framing ready" : "Framing ready",
      compositionMode === COMPOSITION_SPLIT
        ? "Drag or resize the Left and Right sections to combine them into one video."
        : "Drag the area you want or fine-tune it with the handles, then start recording.",
    );
  } else {
    renderSelectionBoxes();
    updateButtonState();
  }
  updateCompositionUi();
  void persistStudioPreferences();
}

function setActiveSection(sectionId) {
  if (compositionMode !== COMPOSITION_SPLIT || (sectionId !== "left" && sectionId !== "right")) {
    return;
  }

  activeSectionId = sectionId;
  renderSelectionBoxes();
  updateCompositionUi();
  void persistStudioPreferences();
}

function beginSelectionTransform(event, sectionId, handle) {
  if (!sourceStream || recordingActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (compositionMode === COMPOSITION_SPLIT) {
    setActiveSection(sectionId);
  }

  const currentRect = selectionRects[sectionId];
  if (!currentRect) {
    return;
  }

  selectionDrag = {
    type: "transform",
    sectionId,
    handle,
    startPointer: {
      x: event.clientX,
      y: event.clientY,
    },
    startRect: { ...currentRect },
  };
  previewStageElement.setPointerCapture(event.pointerId);
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
    box.addEventListener("pointerdown", (event) => {
      if (event.target !== box) {
        return;
      }
      beginSelectionTransform(event, sectionId, "move");
    });

    const grid = document.createElement("div");
    grid.className = "selection-grid";

    const header = document.createElement("div");
    header.className = "selection-header";
    const label = document.createElement("span");
    label.className = "selection-label";
    label.textContent = SECTION_LABELS[sectionId];
    header.append(label);

    const size = document.createElement("span");
    size.className = "selection-size";
    size.textContent = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;

    box.append(grid, header, size);

    for (const handle of HANDLE_DEFINITIONS) {
      const handleElement = document.createElement("button");
      handleElement.type = "button";
      handleElement.className = "selection-handle";
      handleElement.dataset.handle = handle.id;
      handleElement.style.left = handle.x;
      handleElement.style.top = handle.y;
      handleElement.addEventListener("pointerdown", (event) => {
        beginSelectionTransform(event, sectionId, handle.id);
      });
      box.append(handleElement);
    }

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

function getSourceDeltaFromPointerDelta(deltaX, deltaY) {
  if (!studioContext) {
    return {
      x: 0,
      y: 0,
    };
  }

  const bounds = getPreviewBounds();
  if (bounds.width < 1 || bounds.height < 1) {
    return {
      x: 0,
      y: 0,
    };
  }

  return {
    x: (deltaX / bounds.width) * studioContext.sourceWidth,
    y: (deltaY / bounds.height) * studioContext.sourceHeight,
  };
}

function translateSelectionRect(rect, delta) {
  if (!studioContext) {
    return rect;
  }

  return normalizeSelectionRect({
    x: clamp(rect.x + delta.x, 0, studioContext.sourceWidth - rect.width),
    y: clamp(rect.y + delta.y, 0, studioContext.sourceHeight - rect.height),
    width: rect.width,
    height: rect.height,
  });
}

function resizeSelectionRect(rect, delta, handle) {
  if (!studioContext) {
    return rect;
  }

  const minimum = getMinimumSelectionSize();
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle.includes("w")) {
    left = clamp(rect.x + delta.x, 0, right - minimum.width);
  }
  if (handle.includes("e")) {
    right = clamp(rect.x + rect.width + delta.x, left + minimum.width, studioContext.sourceWidth);
  }
  if (handle.includes("n")) {
    top = clamp(rect.y + delta.y, 0, bottom - minimum.height);
  }
  if (handle.includes("s")) {
    bottom = clamp(rect.y + rect.height + delta.y, top + minimum.height, studioContext.sourceHeight);
  }

  return normalizeSelectionRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

function getNextSelectionRectFromTransform(interaction, event) {
  const delta = getSourceDeltaFromPointerDelta(
    event.clientX - interaction.startPointer.x,
    event.clientY - interaction.startPointer.y,
  );
  if (interaction.handle === "move") {
    return translateSelectionRect(interaction.startRect, delta);
  }

  return resizeSelectionRect(interaction.startRect, delta, interaction.handle);
}

function waitForVideoReady(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("The shared source took too long to open."));
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
      rejectPromise(new Error("Couldn't open the shared preview."));
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
        rejectPromise(new Error(`${studioContext.captureLabel} sharing was canceled.`));
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

function stopRenderLoop() {
  if (!renderLoopId) {
    return;
  }

  cancelAnimationFrame(renderLoopId);
  renderLoopId = null;
}

function stopSourceStream() {
  sourceStream?.getTracks?.().forEach((track) => track.stop());
  sourceStream = null;
  previewVideoElement.srcObject = null;
  stopRenderLoop();
  clearCompositePreview();
}

async function preparePreview() {
  setStatus("Opening share picker...", `Choose a ${studioContext.captureLabel} source, then click Share.`);
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
  ensureRenderLoop();
  setStatus(
    compositionMode === COMPOSITION_SPLIT ? "2-Up framing ready" : "Framing ready",
    compositionMode === COMPOSITION_SPLIT
      ? "Drag or resize the Left and Right sections to combine them into a single video."
      : "Drag the area you want or adjust it with the handles, then start recording.",
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

function scalePlan(plan, factor) {
  return {
    ...plan,
    canvasWidth: Math.max(1, Math.round(plan.canvasWidth * factor)),
    canvasHeight: Math.max(1, Math.round(plan.canvasHeight * factor)),
    sections: plan.sections.map((section) => ({
      ...section,
      targetRect: scaleRect(section.targetRect, factor),
    })),
  };
}

function buildSingleRecordingPlan() {
  const rect = selectionRects.single ?? createInsetSelectionRect();
  if (!rect) {
    throw new Error("Select a recording area in the preview first.");
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
    throw new Error("2-Up recording requires both Left and Right sections.");
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

function getDisplayPreviewPlan(basePlan) {
  const scale = Math.min(1, PREVIEW_RENDER_MAX_EDGE / Math.max(basePlan.canvasWidth, basePlan.canvasHeight));
  return scale < 1 ? scalePlan(basePlan, scale) : basePlan;
}

function drawPlanFrame(context, canvas, plan) {
  context.fillStyle = getCompositeFillColor(plan.mode);
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const section of plan.sections) {
    context.drawImage(
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
}

function renderCompositePreviewFrame() {
  if (!sourceStream || !studioContext || !hasRecordingSelection()) {
    clearCompositePreview();
    return;
  }

  const basePlan = recordingPlan ?? createRecordingPlan();
  const previewPlan = getDisplayPreviewPlan(basePlan);
  compositePreviewEmptyElement.classList.add("is-hidden");
  compositeSizeChipElement.textContent = `${basePlan.canvasWidth} x ${basePlan.canvasHeight}`;
  if (compositePreviewCanvas.width !== previewPlan.canvasWidth || compositePreviewCanvas.height !== previewPlan.canvasHeight) {
    compositePreviewCanvas.width = previewPlan.canvasWidth;
    compositePreviewCanvas.height = previewPlan.canvasHeight;
  }
  drawPlanFrame(compositePreviewContext, compositePreviewCanvas, previewPlan);
}

function renderRecordingFrame() {
  if (!recordingActive || !recordingPlan) {
    return;
  }

  drawPlanFrame(recordingContext, recordingCanvas, recordingPlan);
}

function runRenderLoop() {
  renderCompositePreviewFrame();
  renderRecordingFrame();
  if (sourceStream || recordingActive) {
    renderLoopId = requestAnimationFrame(runRenderLoop);
  } else {
    renderLoopId = null;
  }
}

function ensureRenderLoop() {
  if (renderLoopId) {
    return;
  }

  renderLoopId = requestAnimationFrame(runRenderLoop);
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
      rejectPromise(reader.error ?? new Error("Couldn't read the recording data."));
    };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        rejectPromise(new Error("Couldn't convert the recording data."));
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

  await persistStudioPreferences();
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
    compositionMode === COMPOSITION_SPLIT ? "Recording 2-Up" : "Recording",
    compositionMode === COMPOSITION_SPLIT
      ? "Recording the selected Left and Right sections as one combined video."
      : "You can stop this recording from the popup or the terminal.",
  );
  ensureRenderLoop();
  recorder.start(1_000);
}

function requestStopRecordingFromStudio() {
  if (!recordingActive || stopping) {
    return Promise.resolve();
  }

  stopping = true;
  updateButtonState();
  setStatus("Finishing recording...", "It will be saved to your Downloads folder when it's ready.");
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
  storedStudioPreferences = await KumaPickerExtensionLiveCaptureSettings.readStudioPreferences(studioContext.captureKind);
  compositionMode = storedStudioPreferences.compositionMode === COMPOSITION_SPLIT ? COMPOSITION_SPLIT : COMPOSITION_SINGLE;
  activeSectionId =
    compositionMode === COMPOSITION_SPLIT
      ? (storedStudioPreferences.activeSectionId === "right" ? "right" : "left")
      : COMPOSITION_SINGLE;
  previewScaleElement.value = String(storedStudioPreferences.previewScalePercent);
  setPreviewScale(storedStudioPreferences.previewScalePercent);
  applyStudioCopy();
  updateButtonState();
}

chooseSourceButton.addEventListener("click", async () => {
  try {
    await preparePreview();
  } catch (error) {
    setStatus("Couldn't start sharing", error instanceof Error ? error.message : String(error));
  }
});

useFullFrameButton.addEventListener("click", () => {
  if (!sourceStream) {
    return;
  }

  if (compositionMode === COMPOSITION_SPLIT) {
    applyDefaultSelections({ useStored: false });
    setStatus("Reset to the default 2-Up layout", "Drag or resize each side again to adjust the layout.");
    void persistStudioPreferences();
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
  setStatus("Using full frame", "The entire shared source will be recorded.");
  void persistStudioPreferences();
});

resetCompositionButton.addEventListener("click", () => {
  if (!sourceStream) {
    return;
  }

  applyDefaultSelections({ useStored: false });
  setStatus(
    compositionMode === COMPOSITION_SPLIT ? "Reset to the default 2-Up layout" : "Reset to the default frame",
    compositionMode === COMPOSITION_SPLIT
      ? "Drag or resize Left and Right again to adjust the layout."
      : "Drag the frame again or adjust it with the handles.",
  );
  void persistStudioPreferences();
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
    setStatus("Couldn't start recording", error instanceof Error ? error.message : String(error));
  }
});

stopRecordingButton.addEventListener("click", async () => {
  try {
    const result = await requestStopRecordingFromStudio();
    if (result?.ok) {
      setStatus("Recording saved", "You can find it in your Downloads folder.");
      window.setTimeout(() => window.close(), 700);
    }
  } catch (error) {
    setStatus("Couldn't stop recording", error instanceof Error ? error.message : String(error));
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
    type: "draw",
    sectionId: getActiveSectionId(),
    startPointer: {
      x: event.clientX,
      y: event.clientY,
    },
  };
  previewStageElement.setPointerCapture(event.pointerId);
  const nextSelection = getSelectionFromPoints(selectionDrag.startPointer, { x: event.clientX, y: event.clientY });
  if (nextSelection) {
    setSelectionRect(selectionDrag.sectionId, nextSelection);
  }
});

previewStageElement.addEventListener("pointermove", (event) => {
  if (!selectionDrag || recordingActive) {
    return;
  }

  const nextSelection =
    selectionDrag.type === "transform"
      ? getNextSelectionRectFromTransform(selectionDrag, event)
      : getSelectionFromPoints(selectionDrag.startPointer, { x: event.clientX, y: event.clientY });
  if (nextSelection) {
    setSelectionRect(selectionDrag.sectionId, nextSelection);
  }
});

previewStageElement.addEventListener("pointerup", (event) => {
  if (!selectionDrag) {
    return;
  }

  if (previewStageElement.hasPointerCapture?.(event.pointerId)) {
    previewStageElement.releasePointerCapture(event.pointerId);
  }
  selectionDrag = null;
  void persistStudioPreferences();
});

previewStageElement.addEventListener("pointercancel", (event) => {
  if (previewStageElement.hasPointerCapture?.(event.pointerId)) {
    previewStageElement.releasePointerCapture(event.pointerId);
  }
  selectionDrag = null;
});

previewScaleElement.addEventListener("input", (event) => {
  setPreviewScale(event.currentTarget?.value);
});

previewScaleElement.addEventListener("change", () => {
  void persistStudioPreferences();
});

window.addEventListener("resize", () => {
  renderSelectionBoxes();
  renderCompositePreviewFrame();
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
  stopRenderLoop();
  stopSourceStream();
});

setPreviewScale(previewScaleElement.value);
clearCompositePreview();

void loadStudioContext().catch((error) => {
  setStatus("Couldn't open Capture Studio", error instanceof Error ? error.message : String(error));
});
