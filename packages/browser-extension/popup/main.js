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

async function sendBridgeMessage(type, daemonUrl = daemonUrlInput.value) {
  const savedDaemonUrl = await writeDaemonUrl(daemonUrl);
  return chrome.runtime.sendMessage({
    type,
    daemonUrl: savedDaemonUrl,
    ...(await readActiveTab()),
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
  });

  try {
    const result = await sendBridgeMessage("agent-picker:test-daemon", daemonUrl);
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
      label: result?.browserTransport === "legacy-poll" ? "Bridge connected (legacy)" : "Bridge connected",
      url: daemonUrl,
      showForm: false,
      pageState: result?.currentPageReady === true ? "ready" : "unavailable",
      pageLabel: result?.currentPageReady === true ? "Current page ready" : "Current page unavailable",
      pageMeta: formatCurrentPageMeta(result),
    });

    if (showFailure) {
      setFeedback(
        result?.currentPageReady === true
          ? "Bridge connected and the current page is ready."
          : "Bridge connected, but the current page is not ready for Agent Picker commands.",
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
    });

    if (showFailure) {
      setFeedback(error instanceof Error ? error.message : String(error), "error");
    } else {
      setFeedback("", "idle");
    }

    return false;
  }
}

async function runAction(type, workingMessage, successMessage) {
  setBusyState(true);
  setFeedback(workingMessage, "working");

  try {
    const result = await sendBridgeMessage(type);
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
  setBusyState(false);
});

connectDaemonButton.addEventListener("click", async () => {
  setBusyState(true);
  await refreshConnectionState(true);
  setBusyState(false);
});

capturePageButton.addEventListener("click", async () => {
  await runAction(
    "agent-picker:capture-page",
    "Capturing the current page...",
    "Current page saved to the bridge.",
  );
});

inspectElementButton.addEventListener("click", async () => {
  const ok = await runAction(
    "agent-picker:start-inspect",
    "Inspect mode armed. Click an element or drag an area in the page.",
    "Inspect mode armed. Click the target element or drag the area you want to save.",
  );

  if (ok) {
    window.close();
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
