const REFACTOR_PROMPT =
  "Please refactor this by clearly separating responsibilities, untangling any spaghetti code, and removing dead code and unnecessary fallbacks. If possible, keep each file under 500 lines.";
const CAPTURE_SELECTOR_DEFAULT_INSET = 0.1;
const CAPTURE_SELECTOR_MIN_DISPLAY_SIZE = 18;

let preparedLiveCapture = null;
let captureSelection = null;
let captureSelectionDrag = null;

function formatCurrentPageMeta(result) {
  if (result?.currentPageReady === true) {
    return "";
  }

  if (result?.currentPage?.title) {
    return result.currentPage.title;
  }

  if (result?.currentPage?.url) {
    return result.currentPage.url;
  }

  if (typeof result?.currentPageMessage === "string") {
    return result.currentPageMessage;
  }

  return "";
}

async function sendBridgeMessage(type, daemonUrl = daemonUrlInput.value, extra = {}) {
  const savedDaemonUrl = await writeDaemonUrl(daemonUrl);
  return chrome.runtime.sendMessage({
    type,
    daemonUrl: savedDaemonUrl,
    ...(await readActiveTab()),
    ...extra,
  });
}

function getLiveCaptureTargetTabId() {
  if (Number.isInteger(currentPageTabId)) {
    return currentPageTabId;
  }

  throw new Error("No current page tab is available for live capture.");
}

function getSelectedLiveCaptureSource() {
  const selectedSource = liveCaptureSourceElements.find((input) => input.checked);
  const candidate = typeof selectedSource?.value === "string" ? selectedSource.value : "tab";
  return candidate === "window" || candidate === "screen" ? candidate : "tab";
}

function getLiveCaptureSourceLabel(source) {
  switch (source) {
    case "window":
      return "Window";
    case "screen":
      return "Screen";
    default:
      return "Current tab";
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDisplayRect(rect) {
  const width = Math.max(0, Math.round(rect.width));
  const height = Math.max(0, Math.round(rect.height));
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width,
    height,
  };
}

async function requestTabLiveCaptureStreamId() {
  if (typeof chrome.tabCapture?.getMediaStreamId !== "function") {
    throw new Error("This Chrome build does not expose tab capture in the extension popup.");
  }

  return chrome.tabCapture.getMediaStreamId({
    targetTabId: getLiveCaptureTargetTabId(),
  });
}

async function requestDesktopLiveCapture(source) {
  if (typeof chrome.desktopCapture?.chooseDesktopMedia !== "function") {
    throw new Error("This Chrome build does not expose desktop capture in the extension popup.");
  }

  const desktopSource = source === "window" ? "window" : "screen";

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const handleResult = (streamId, options = {}) => {
      if (settled) {
        return;
      }

      settled = true;
      if (!streamId) {
        rejectPromise(new Error(`${getLiveCaptureSourceLabel(source)} capture was cancelled.`));
        return;
      }

      resolvePromise({
        streamId,
        captureKind: desktopSource,
        canRequestAudioTrack: options?.canRequestAudioTrack === true,
      });
    };

    try {
      chrome.desktopCapture.chooseDesktopMedia([desktopSource, "audio"], handleResult);
    } catch (error) {
      settled = true;
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function requestLiveCaptureStartOptions() {
  const source = getSelectedLiveCaptureSource();
  if (source === "tab") {
    return {
      streamId: await requestTabLiveCaptureStreamId(),
      captureKind: "tab",
      canRequestAudioTrack: true,
    };
  }

  return requestDesktopLiveCapture(source);
}

function getPreparedCaptureTitle(prepared) {
  return `${prepared.captureLabel} framing`;
}

function getPreparedCaptureHint(prepared) {
  return `Drag across the ${prepared.captureLabel.toLowerCase()} preview to crop your recording area.`;
}

function getCapturePreviewRect() {
  return normalizeDisplayRect(capturePreviewImageElement.getBoundingClientRect());
}

function clearCaptureSelectionBox() {
  captureSelectionBoxElement.classList.add("is-hidden");
  captureSelectionBoxElement.style.left = "0px";
  captureSelectionBoxElement.style.top = "0px";
  captureSelectionBoxElement.style.width = "0px";
  captureSelectionBoxElement.style.height = "0px";
  captureSelectionSizeElement.textContent = "";
}

function renderCaptureSelection() {
  if (!preparedLiveCapture || !captureSelection) {
    clearCaptureSelectionBox();
    return;
  }

  const previewRect = getCapturePreviewRect();
  if (previewRect.width < 1 || previewRect.height < 1) {
    clearCaptureSelectionBox();
    return;
  }

  const scaleX = previewRect.width / preparedLiveCapture.sourceWidth;
  const scaleY = previewRect.height / preparedLiveCapture.sourceHeight;
  captureSelectionBoxElement.classList.remove("is-hidden");
  captureSelectionBoxElement.style.left = `${Math.round(captureSelection.x * scaleX)}px`;
  captureSelectionBoxElement.style.top = `${Math.round(captureSelection.y * scaleY)}px`;
  captureSelectionBoxElement.style.width = `${Math.max(1, Math.round(captureSelection.width * scaleX))}px`;
  captureSelectionBoxElement.style.height = `${Math.max(1, Math.round(captureSelection.height * scaleY))}px`;
  captureSelectionSizeElement.textContent = `${Math.round(captureSelection.width)} x ${Math.round(captureSelection.height)}`;
}

function setCaptureSelection(rect) {
  if (!preparedLiveCapture || !rect) {
    captureSelection = null;
    renderCaptureSelection();
    return;
  }

  captureSelection = {
    x: clamp(Math.round(rect.x), 0, Math.max(0, preparedLiveCapture.sourceWidth - 1)),
    y: clamp(Math.round(rect.y), 0, Math.max(0, preparedLiveCapture.sourceHeight - 1)),
    width: clamp(Math.round(rect.width), 1, preparedLiveCapture.sourceWidth),
    height: clamp(Math.round(rect.height), 1, preparedLiveCapture.sourceHeight),
  };
  renderCaptureSelection();
}

function setFullFrameCaptureSelection() {
  if (!preparedLiveCapture) {
    return;
  }

  setCaptureSelection({
    x: 0,
    y: 0,
    width: preparedLiveCapture.sourceWidth,
    height: preparedLiveCapture.sourceHeight,
  });
}

function setDefaultCaptureSelection() {
  if (!preparedLiveCapture) {
    return;
  }

  const insetX = Math.round(preparedLiveCapture.sourceWidth * CAPTURE_SELECTOR_DEFAULT_INSET);
  const insetY = Math.round(preparedLiveCapture.sourceHeight * CAPTURE_SELECTOR_DEFAULT_INSET);
  setCaptureSelection({
    x: insetX,
    y: insetY,
    width: Math.max(1, preparedLiveCapture.sourceWidth - insetX * 2),
    height: Math.max(1, preparedLiveCapture.sourceHeight - insetY * 2),
  });
}

function getCropRectFromDrag(startPoint, currentPoint) {
  const previewRect = getCapturePreviewRect();
  if (!preparedLiveCapture || previewRect.width < 1 || previewRect.height < 1) {
    return null;
  }

  const scaleX = preparedLiveCapture.sourceWidth / previewRect.width;
  const scaleY = preparedLiveCapture.sourceHeight / previewRect.height;
  const startX = clamp(startPoint.x - previewRect.x, 0, previewRect.width);
  const startY = clamp(startPoint.y - previewRect.y, 0, previewRect.height);
  const currentX = clamp(currentPoint.x - previewRect.x, 0, previewRect.width);
  const currentY = clamp(currentPoint.y - previewRect.y, 0, previewRect.height);
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  if (width < CAPTURE_SELECTOR_MIN_DISPLAY_SIZE || height < CAPTURE_SELECTOR_MIN_DISPLAY_SIZE) {
    return null;
  }

  return {
    x: left * scaleX,
    y: top * scaleY,
    width: width * scaleX,
    height: height * scaleY,
  };
}

function resetPreparedCaptureUi() {
  preparedLiveCapture = null;
  captureSelection = null;
  captureSelectionDrag = null;
  capturePreviewImageElement.removeAttribute("src");
  clearCaptureSelectionBox();
  setCaptureSelectorState({ active: false });
}

function openCaptureSelector(prepared) {
  preparedLiveCapture = prepared;
  capturePreviewImageElement.src = prepared.previewDataUrl;
  setCaptureSelectorState({
    active: true,
    title: getPreparedCaptureTitle(prepared),
    meta: `Drag a crop over the ${prepared.captureLabel.toLowerCase()} preview, then start recording.`,
    hint: getPreparedCaptureHint(prepared),
    startLabel: `Start ${prepared.captureLabel} Capture`,
  });
  requestAnimationFrame(() => {
    setDefaultCaptureSelection();
  });
}

async function discardPreparedLiveCapture() {
  if (!preparedLiveCapture) {
    resetPreparedCaptureUi();
    return;
  }

  const preparedCaptureId = preparedLiveCapture.preparedCaptureId;
  resetPreparedCaptureUi();

  try {
    await sendBridgeMessage("kuma-picker:discard-live-capture-prepare", daemonUrlInput.value, {
      tabId: getLiveCaptureTargetTabId(),
      preparedCaptureId,
    });
  } catch {}
}

async function prepareScreenOrWindowLiveCapture(capture) {
  setFeedback("Building a framing preview...", "working");
  const result = await sendBridgeMessage("kuma-picker:prepare-live-capture", daemonUrlInput.value, {
    tabId: getLiveCaptureTargetTabId(),
    streamId: capture.streamId,
    captureKind: capture.captureKind,
    canRequestAudioTrack: capture.canRequestAudioTrack,
  });
  if (!result?.ok) {
    throw new Error(result?.error || "The bridge could not prepare the live capture preview.");
  }

  openCaptureSelector({
    preparedCaptureId: result.preparedCapture.id,
    previewDataUrl: result.preparedCapture.previewDataUrl,
    sourceWidth: result.preparedCapture.sourceWidth,
    sourceHeight: result.preparedCapture.sourceHeight,
    captureKind: result.preparedCapture.captureKind,
    captureLabel: result.preparedCapture.captureLabel,
  });
  setFeedback("Framing preview ready.", "success");
}

async function refreshConnectionState(showFailure = false) {
  const daemonUrl = await writeDaemonUrl(daemonUrlInput.value);
  setConnectionState({
    state: "checking",
    label: "Checking bridge...",
    url: daemonUrl,
    showForm: false,
    pageState: "checking",
    pageLabel: "Checking current page...",
    pageMeta: "",
    pageTabId: null,
  });

  try {
    const result = await sendBridgeMessage("kuma-picker:test-daemon", daemonUrl);
    if (!result?.ok) {
      const error = result?.error || result?.message || "The bridge did not return a result.";
      const bridgeLabel = result?.healthOk ? "Daemon reachable, socket failed" : "Bridge offline";
      setConnectionState({
        state: "disconnected",
        label: bridgeLabel,
        url: daemonUrl,
        showForm: true,
        pageState: "unavailable",
        pageLabel: "Current page unavailable",
        pageMeta: error,
        pageTabId: result?.currentPageTabId ?? null,
      });

      if (showFailure) {
        setFeedback(error, "error");
      } else {
        setFeedback("", "idle");
      }

      return false;
    }

    setConnectionState({
      state: "connected",
      label: "Bridge connected",
      url: daemonUrl,
      showForm: false,
      pageState: result?.currentPageReady === true ? "ready" : "unavailable",
      pageLabel: result?.currentPageReady === true ? "Current page ready" : "Current page unavailable",
      pageMeta: formatCurrentPageMeta(result),
      pageTabId: result?.currentPageTabId ?? null,
    });

    if (showFailure) {
      setFeedback(
        result?.currentPageReady === true
          ? "Bridge connected and the current page is ready."
          : "Bridge connected, but the current page is not ready for Kuma Picker commands.",
        result?.currentPageReady === true ? "success" : "error",
      );
    }

    return true;
  } catch (error) {
    setConnectionState({
      state: "disconnected",
      label: "Bridge offline",
      url: daemonUrl,
      showForm: true,
      pageState: "unavailable",
      pageLabel: "Current page unavailable",
      pageMeta: "The bridge is offline, so the current page could not be checked.",
      pageTabId: null,
    });

    if (showFailure) {
      setFeedback(error instanceof Error ? error.message : String(error), "error");
    } else {
      setFeedback("", "idle");
    }

    return false;
  }
}

function formatLiveCaptureMeta(result) {
  if (result?.active === true) {
    const parts = [];
    if (result?.recording?.page?.title) {
      parts.push(result.recording.page.title);
    }
    if (typeof result?.recording?.captureLabel === "string" && result.recording.captureLabel) {
      parts.push(result.recording.captureLabel);
    }
    if (Number.isFinite(result?.recording?.fps)) {
      parts.push(`${result.recording.fps}fps`);
    }
    if (parts.length > 0) {
      return parts.join(" · ");
    }
    if (result?.recording?.filename) {
      return result.recording.filename;
    }
  }

  return "";
}

async function refreshLiveCaptureState() {
  try {
    const result = await sendBridgeMessage("kuma-picker:get-live-capture-state", daemonUrlInput.value);
    if (!result?.ok) {
      throw new Error(result?.error || "The bridge did not return the live capture state.");
    }

    setLiveCaptureState({
      state: result.active === true ? "recording" : "idle",
      label: result.active === true ? "Live capture recording" : "Live capture idle",
      meta: formatLiveCaptureMeta(result),
      active: result.active === true,
    });
  } catch (error) {
    setLiveCaptureState({
      state: "error",
      label: "Live capture unavailable",
      meta: error instanceof Error ? error.message : String(error),
      active: false,
    });
  }
}

async function runAction(type, workingMessage, successMessage, extra = {}) {
  setBusyState(true);
  setFeedback(workingMessage, "working");

  try {
    const result = await sendBridgeMessage(type, daemonUrlInput.value, extra);
    if (!result?.ok) {
      throw new Error(result?.error || "The bridge did not return a result.");
    }

    setFeedback(result.message || successMessage, "success");
    updateSavedSelectionLabel(result);
    return true;
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), "error");
    return false;
  } finally {
    setBusyState(false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  daemonUrlInput.value = await readDaemonUrl();
  const liveCaptureSettings = await KumaPickerExtensionLiveCaptureSettings.read();
  setSelectedLiveCaptureSourceValue(liveCaptureSettings.source);
  setRefactorPrompt(REFACTOR_PROMPT);
  setLastSaved("");
  setFeedback("", "idle");
  setBusyState(true);
  await refreshConnectionState(false);
  await refreshLiveCaptureState();
  setBusyState(false);
});

connectDaemonButton.addEventListener("click", async () => {
  if (!isConnectionEditMode()) {
    setConnectionEditMode(true, { focus: true });
    return;
  }

  setBusyState(true);
  await refreshConnectionState(true);
  await refreshLiveCaptureState();
  setConnectionEditMode(false);
  setBusyState(false);
});

capturePageButton.addEventListener("click", async () => {
  await runAction(
    "kuma-picker:capture-page",
    "Capturing the current page...",
    "Current page saved to the bridge.",
  );
});

inspectElementButton.addEventListener("click", async () => {
  const ok = await runAction(
    "kuma-picker:start-inspect",
    "Inspect mode armed. Click an element or drag an area in the page.",
    "Inspect mode armed. Click the target element or drag the area you want to save.",
  );

  if (ok) {
    window.close();
  }
});

inspectWithJobButton.addEventListener("click", async () => {
  const ok = await runAction(
    "kuma-picker:start-inspect",
    "Job pick mode armed. Click an element or drag an area, then write the job.",
    "Job pick mode armed. Pick the target first, then write the job you want the agent to handle.",
    { withJob: true },
  );

  if (ok) {
    window.close();
  }
});

startLiveCaptureButton.addEventListener("click", async () => {
  setBusyState(true);
  const selectedSource = getSelectedLiveCaptureSource();
  setFeedback(
    selectedSource === "tab"
      ? "Requesting current tab capture access..."
      : `Opening Capture Studio for ${getLiveCaptureSourceLabel(selectedSource).toLowerCase()} capture...`,
    "working",
  );

  try {
    if (selectedSource === "window" || selectedSource === "screen") {
      const result = await sendBridgeMessage("kuma-picker:open-live-capture-studio", daemonUrlInput.value, {
        tabId: getLiveCaptureTargetTabId(),
        captureKind: selectedSource,
      });
      if (!result?.ok) {
        throw new Error(result?.error || "The bridge did not open Capture Studio.");
      }

      setFeedback(result.message || "Capture Studio opened.", "success");
      window.close();
    } else {
      const capture = await requestLiveCaptureStartOptions();
      setFeedback("Starting live capture...", "working");
      const result = await sendBridgeMessage("kuma-picker:start-live-capture", daemonUrlInput.value, {
        tabId: getLiveCaptureTargetTabId(),
        streamId: capture.streamId,
        captureKind: capture.captureKind,
        canRequestAudioTrack: capture.canRequestAudioTrack,
      });
      if (!result?.ok) {
        throw new Error(result?.error || "The bridge did not return a result.");
      }

      setFeedback(result.message || "Live capture started.", "success");
      await refreshLiveCaptureState();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(message, "error");
    setLiveCaptureState({
      state: "error",
      label: "Live capture failed to start",
      meta: message,
      active: false,
    });
  } finally {
    setBusyState(false);
  }
});

captureSelectorCloseButton.addEventListener("click", async () => {
  setBusyState(true);
  setFeedback("Closing the framing preview...", "working");
  try {
    await discardPreparedLiveCapture();
    setFeedback("Framing preview dismissed.", "success");
  } finally {
    setBusyState(false);
  }
});

captureSelectorFullButton.addEventListener("click", () => {
  setFullFrameCaptureSelection();
  setFeedback("Using the full shared surface.", "success");
});

captureSelectorStartButton.addEventListener("click", async () => {
  if (!preparedLiveCapture) {
    return;
  }

  setBusyState(true);
  setFeedback("Starting live capture...", "working");

  try {
    const result = await sendBridgeMessage("kuma-picker:start-live-capture", daemonUrlInput.value, {
      tabId: getLiveCaptureTargetTabId(),
      preparedCaptureId: preparedLiveCapture.preparedCaptureId,
      cropRect: captureSelection,
    });
    if (!result?.ok) {
      throw new Error(result?.error || "The bridge did not return a result.");
    }

    resetPreparedCaptureUi();
    setFeedback(result.message || "Live capture started.", "success");
    await refreshLiveCaptureState();
    window.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(message, "error");
  } finally {
    setBusyState(false);
  }
});

stopLiveCaptureButton.addEventListener("click", async () => {
  setBusyState(true);
  setFeedback("Stopping live capture...", "working");

  try {
    const result = await sendBridgeMessage("kuma-picker:stop-live-capture", daemonUrlInput.value);
    if (!result?.ok) {
      throw new Error(result?.error || "The bridge did not return a result.");
    }

    setFeedback(result.message || "Live capture saved.", "success");
    await refreshLiveCaptureState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(message, "error");
    setLiveCaptureState({
      state: "error",
      label: "Live capture failed to stop",
      meta: message,
      active: true,
    });
  } finally {
    setBusyState(false);
  }
});

copyRefactorPromptButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

copyRefactorPromptButton.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  try {
    await navigator.clipboard.writeText(REFACTOR_PROMPT);
    setFeedback("Refactor prompt copied.", "success");
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), "error");
  }
});

capturePreviewStageElement.addEventListener("pointerdown", (event) => {
  if (!preparedLiveCapture || event.button !== 0) {
    return;
  }

  captureSelectionDrag = {
    startX: event.clientX,
    startY: event.clientY,
  };
  capturePreviewStageElement.setPointerCapture(event.pointerId);
  const nextSelection = getCropRectFromDrag(
    { x: captureSelectionDrag.startX, y: captureSelectionDrag.startY },
    { x: event.clientX, y: event.clientY },
  );
  if (nextSelection) {
    setCaptureSelection(nextSelection);
  }
});

capturePreviewStageElement.addEventListener("pointermove", (event) => {
  if (!captureSelectionDrag) {
    return;
  }

  const nextSelection = getCropRectFromDrag(
    { x: captureSelectionDrag.startX, y: captureSelectionDrag.startY },
    { x: event.clientX, y: event.clientY },
  );
  if (nextSelection) {
    setCaptureSelection(nextSelection);
  }
});

capturePreviewStageElement.addEventListener("pointerup", (event) => {
  if (!captureSelectionDrag) {
    return;
  }

  capturePreviewStageElement.releasePointerCapture(event.pointerId);
  captureSelectionDrag = null;
  if (!captureSelection) {
    setDefaultCaptureSelection();
  }
});

capturePreviewStageElement.addEventListener("pointercancel", () => {
  captureSelectionDrag = null;
});

window.addEventListener("pagehide", () => {
  if (preparedLiveCapture) {
    void discardPreparedLiveCapture();
  }
});
