const REFACTOR_PROMPT =
  "Please refactor this by clearly separating responsibilities, untangling any spaghetti code, and removing dead code and unnecessary fallbacks. If possible, keep each file under 500 lines.";

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
  });

  try {
    const result = await sendBridgeMessage("agent-picker:test-daemon", daemonUrl);
    if (!result?.ok) {
      throw new Error(result?.error || "The bridge did not return a result.");
    }

    setConnectionState({
      state: "connected",
      label: "Connected",
      url: daemonUrl,
      showForm: false,
    });

    if (showFailure) {
      setFeedback("Bridge connected.", "success");
    }

    return true;
  } catch (error) {
    setConnectionState({
      state: "disconnected",
      label: "Bridge offline",
      url: daemonUrl,
      showForm: true,
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
