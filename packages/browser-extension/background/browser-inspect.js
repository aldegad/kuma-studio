async function handleCapturePage(daemonUrl, message) {
  const tab = await resolveTargetTab(message);
  const pageContext = await collectPageContext(tab.id);
  pageContext.page = {
    ...pageContext.page,
    tabId: tab.id,
    windowId: tab.windowId,
  };
  const screenshotDataUrl = await captureTabScreenshot(tab.windowId);
  const selection = await saveSelectionToDaemon(daemonUrl, pageContext, screenshotDataUrl);
  await reportExtensionHeartbeatSafely(daemonUrl, {
    source: "popup:capture-page",
    page: pageContext.page,
  });

  return {
    ok: true,
    message: "Current page saved to the bridge.",
    selection,
  };
}

async function captureInspectScreenshot(windowId, message) {
  const screenshotDataUrl = await captureTabScreenshot(windowId);

  if (!message.captureRect) {
    return screenshotDataUrl;
  }

  return cropTabScreenshot(screenshotDataUrl, message.captureRect, message.pageContext?.viewport);
}

async function handleStartInspect(daemonUrl, message) {
  const tab = await resolveTargetTab(message);
  await ensureInteractiveKumaPicker(tab.id);
  await setInspectState(tab.id, daemonUrl);
  await enableInspectBadge(tab.id);

  const response = await sendMessageToTab(tab.id, {
    type: "kuma-picker:start-inspect",
    withJob: message?.withJob === true,
  });
  if (!response?.ok) {
    await clearInspectState(tab.id);
    throw new Error(response?.error || "Failed to arm inspect mode.");
  }

  await reportExtensionHeartbeatSafely(daemonUrl, {
    source: "popup:start-inspect",
    page: createPageRecordFromTab(tab),
  });

  return {
    ok: true,
    message:
      message?.withJob === true
        ? "Job pick mode armed. Pick the target first, then write the job."
        : "Inspect mode armed. Click the target element in the page.",
  };
}

async function notifyInspectResult(tabId, payload) {
  await sendMessageToTab(tabId, {
    type: "kuma-picker:inspect-result",
    ...payload,
  });
}

async function handleInspectPicked(message, sender) {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (!tabId || !windowId) {
    throw new Error("Missing browser tab information for the picked element.");
  }

  const inspectState = await getInspectState(tabId);
  if (!inspectState?.daemonUrl) {
    throw new Error("Inspect mode is no longer active for this tab.");
  }

  const screenshot = await captureInspectScreenshot(windowId, message);
  const pageContext = {
    ...message.pageContext,
    page: {
      ...message.pageContext?.page,
      tabId,
      windowId,
    },
  };
  const selection = await saveSelectionToDaemon(
    inspectState.daemonUrl,
    pageContext,
    screenshot,
  );
  await reportExtensionHeartbeatSafely(inspectState.daemonUrl, {
    source: "content-script:inspect-picked",
    page: pageContext?.page,
  });
  await syncJobCardsForTab(inspectState.daemonUrl, sender.tab);

  await clearInspectState(tabId);
  await notifyInspectResult(tabId, {
    ok: true,
    message: "Element saved to the local Kuma Picker bridge.",
  });

  return {
    ok: true,
    message: "Element saved to the bridge.",
    selection,
  };
}

async function handleInspectFailure(message, sender, error) {
  if (sender.tab?.id && message?.type === "kuma-picker:inspect-picked") {
    await clearInspectState(sender.tab.id);

    try {
      await notifyInspectResult(sender.tab.id, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Ignore follow-up notification failures after an inspect error.
    }
  }
}
