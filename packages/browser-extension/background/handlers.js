async function collectPageContext(tabId) {
  const response = await sendMessageToTab(tabId, {
    type: "agent-picker:collect-page",
  });

  if (!response?.ok || !response.pageContext) {
    throw new Error(response?.error || "Failed to read the page.");
  }

  return response.pageContext;
}

async function handleCapturePage(daemonUrl, message) {
  const tab = await resolveTargetTab(message);
  const pageContext = await collectPageContext(tab.id);
  const screenshotDataUrl = await captureTabScreenshot(tab.windowId);
  const selection = await saveSelectionToDaemon(daemonUrl, pageContext, screenshotDataUrl);

  return {
    ok: true,
    message: "Current page saved to the bridge.",
    selection,
  };
}

async function handleStartInspect(daemonUrl, message) {
  const tab = await resolveTargetTab(message);
  await setInspectState(tab.id, daemonUrl);
  await enableInspectBadge(tab.id);

  const response = await sendMessageToTab(tab.id, {
    type: "agent-picker:start-inspect",
  });
  if (!response?.ok) {
    await clearInspectState(tab.id);
    throw new Error(response?.error || "Failed to arm inspect mode.");
  }

  return {
    ok: true,
    message: "Inspect mode armed. Click the target element in the page.",
  };
}

async function notifyInspectResult(tabId, payload) {
  await sendMessageToTab(tabId, {
    type: "agent-picker:inspect-result",
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

  const screenshotDataUrl = await captureTabScreenshot(windowId);
  const selection = await saveSelectionToDaemon(
    inspectState.daemonUrl,
    message.pageContext,
    screenshotDataUrl,
  );

  await clearInspectState(tabId);
  await notifyInspectResult(tabId, {
    ok: true,
    message: "Element saved to the local Agent Picker bridge.",
  });

  return {
    ok: true,
    message: "Element saved to the bridge.",
    selection,
  };
}

async function handleInspectFailure(message, sender, error) {
  if (sender.tab?.id && message?.type === "agent-picker:inspect-picked") {
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
