const REFACTOR_PROMPT =
  "Please refactor this by clearly separating responsibilities, untangling any spaghetti code, and removing dead code and unnecessary fallbacks. If possible, keep each file under 500 lines.";

function formatCurrentPageMeta(result) {
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

async function requestLiveCaptureStreamId() {
  if (typeof chrome.tabCapture?.getMediaStreamId !== "function") {
    throw new Error("This Chrome build does not expose tab capture in the extension popup.");
  }

  return chrome.tabCapture.getMediaStreamId({
    targetTabId: getLiveCaptureTargetTabId(),
  });
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
  if (result?.active === true && result?.recording?.page?.title) {
    return `${result.recording.page.title} · ${result.recording.fps}fps`;
  }

  if (result?.active === true && result?.recording?.filename) {
    return result.recording.filename;
  }

  return "Start from this popup to record the current tab at full frame rate.";
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
  setRefactorPrompt(REFACTOR_PROMPT);
  setLastSaved("");
  setFeedback("", "idle");
  setBusyState(true);
  await refreshConnectionState(false);
  await refreshLiveCaptureState();
  setBusyState(false);
});

connectDaemonButton.addEventListener("click", async () => {
  setBusyState(true);
  await refreshConnectionState(true);
  await refreshLiveCaptureState();
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
  setFeedback("Requesting tab capture access...", "working");

  try {
    const streamId = await requestLiveCaptureStreamId();
    setFeedback("Starting live capture...", "working");
    const result = await sendBridgeMessage("kuma-picker:start-live-capture", daemonUrlInput.value, {
      tabId: getLiveCaptureTargetTabId(),
      streamId,
    });
    if (!result?.ok) {
      throw new Error(result?.error || "The bridge did not return a result.");
    }

    setFeedback(result.message || "Live capture started.", "success");
    await refreshLiveCaptureState();
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

copyRefactorPromptButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(REFACTOR_PROMPT);
    setFeedback("Refactor prompt copied.", "success");
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), "error");
  }
});
