const {
  recordingTimeoutMs: RECORDING_TIMEOUT_MS,
  defaultRecordingFps: DEFAULT_RECORDING_FPS,
  maxVisibleTabRecordingFps: MAX_VISIBLE_TAB_RECORDING_FPS,
  defaultSpeedMultiplier: DEFAULT_SPEED_MULTIPLIER,
} = getRecordingConfig();

async function setRecordingOverlayMode(tabId, active) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  try {
    await sendMessageToTab(tabId, {
      type: "kuma-picker:recording-overlay-mode",
      active,
    });
  } catch {
    // Best-effort only. Recording can continue even if the page skipped the overlay mode switch.
  }
}

function clearRecordingTimer(session) {
  if (session?.timerId) {
    clearTimeout(session.timerId);
    session.timerId = null;
  }
}

function scheduleRecordingCapture(session, delayMs = 0) {
  clearRecordingTimer(session);
  session.timerId = setTimeout(() => {
    void captureRecordingFrame(session.id);
  }, Math.max(0, delayMs));
}

async function captureRecordingFrame(recordingId) {
  const session = getRecordingState().activeRecordingSession;
  if (!session || session.id !== recordingId || session.stopping) {
    return;
  }

  const startedAt = Date.now();

  try {
    const targetTab = await focusTargetTab({
      id: session.targetTabId,
      windowId: session.windowId,
      url: session.pageUrl,
    });
    session.pageUrl = typeof targetTab?.url === "string" ? targetTab.url : session.pageUrl;
    const dataUrl = await captureTabScreenshot(targetTab.windowId);
    await sendMessageToRecordingOffscreen({
      type: "kuma-picker:recording-frame",
      recordingId: session.id,
      dataUrl,
    });
    session.frameCount += 1;
  } catch (error) {
    session.captureErrors += 1;
    session.lastCaptureError = error instanceof Error ? error.message : String(error);
    session.lastWarning = "Kuma Picker had to keep refocusing the target tab while recording.";
  } finally {
    const activeSession = getRecordingState().activeRecordingSession;
    if (activeSession?.id === recordingId && activeSession.stopping !== true) {
      const remainingDelay = Math.max(0, session.frameIntervalMs - (Date.now() - startedAt));
      scheduleRecordingCapture(session, remainingDelay);
    }
  }
}

async function cleanupRecordingSession(session, { restorePreviousTab = true } = {}) {
  clearRecordingTimer(session);

  if (
    restorePreviousTab &&
    session?.restorePreviousActiveTab === true &&
    session.previousActiveTab?.id &&
    session.previousActiveTab.id !== session.targetTabId
  ) {
    await restorePreviousActiveTab(session.previousActiveTab).catch(() => null);
  }

  getRecordingState().activeRecordingSession = null;
  await closeRecordingOffscreenDocument().catch(() => null);
}

function readRecordingCommandOptions(command = {}) {
  return {
    fps: Number.isFinite(command?.fps)
      ? Math.max(1, Math.min(MAX_VISIBLE_TAB_RECORDING_FPS, Math.round(command.fps)))
      : DEFAULT_RECORDING_FPS,
    speedMultiplier:
      Number.isFinite(command?.speedMultiplier) && command.speedMultiplier > 0
        ? Math.max(0.25, Math.min(8, command.speedMultiplier))
        : DEFAULT_SPEED_MULTIPLIER,
    focusTabFirst: command?.focusTabFirst !== false,
    restorePreviousActiveTab: command?.restorePreviousActiveTab === true,
    filename: typeof command?.filename === "string" ? command.filename : null,
  };
}

async function resolveRecordingTarget(tab, options) {
  const previousActiveTab =
    options.focusTabFirst && options.restorePreviousActiveTab ? await queryActiveTab().catch(() => null) : null;
  const targetTab = options.focusTabFirst ? await focusTargetTab(tab) : tab;
  const focusedTarget = await waitForFocusedTargetTab(targetTab);

  if (focusedTarget.tab.active !== true || focusedTarget.window.focused !== true) {
    throw new Error("The target tab must be visible and focused before recording can start.");
  }

  return {
    focusedTarget,
    previousActiveTab,
  };
}

function buildActiveRecordingSession({ recordingId, focusedTarget, previousActiveTab, startedAt, filename, fps, speedMultiplier }) {
  const frameIntervalMs = Math.max(80, Math.round(1_000 / fps));

  return {
    id: recordingId,
    targetTabId: focusedTarget.tab.id,
    windowId: focusedTarget.tab.windowId,
    pageUrl: focusedTarget.tab.url,
    previousActiveTab,
    restorePreviousActiveTab: previousActiveTab != null,
    frameIntervalMs,
    fps,
    speedMultiplier,
    filename,
    startedAt,
    timerId: null,
    stopping: false,
    frameCount: 1,
    captureErrors: 0,
    lastWarning: null,
    lastCaptureError: null,
  };
}

function buildRecordingStartResult(session, focusedTarget, options) {
  return {
    page: createPageRecordFromTab(focusedTarget.tab),
    recording: {
      id: session.id,
      status: "recording",
      fps: session.fps,
      speedMultiplier: session.speedMultiplier,
      frameIntervalMs: session.frameIntervalMs,
      startedAt: session.startedAt,
      filename: session.filename,
      targetTabId: focusedTarget.tab.id,
      windowId: focusedTarget.tab.windowId,
      focusTabFirst: options.focusTabFirst,
      restorePreviousActiveTab: options.restorePreviousActiveTab,
    },
  };
}

function buildRecordingStopResult(session, tab, result, download) {
  return {
    page: createPageRecordFromTab(tab),
    recording: {
      id: session.id,
      status: "completed",
      startedAt: session.startedAt,
      stoppedAt: new Date().toISOString(),
      fps: session.fps,
      speedMultiplier: session.speedMultiplier,
      filename: session.filename,
      frameCount: result.frameCount,
      renderedFrameCount: result.renderedFrameCount,
      captureErrors: session.captureErrors,
      durationMs: result.durationMs,
      bytes: result.bytes,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      warning: session.lastWarning ?? "Kuma Picker kept the target tab focused while recording.",
      lastCaptureError: session.lastCaptureError,
    },
    download: serializeDownloadResult(download.record, {
      filenameContains: session.filename.split("/").at(-1) ?? null,
      downloadUrlContains: null,
      startedAfter: session.startedAt,
      contextTargetUrl: tab?.url ?? null,
    }),
    downloadId: download.downloadId,
  };
}

async function startTabRecording(tab, command = {}) {
  const recordingState = getRecordingState();
  if (recordingState.activeRecordingSession) {
    throw new Error("A Kuma Picker browser recording is already active. Stop it before starting another one.");
  }

  const options = readRecordingCommandOptions(command);
  const startedAt = new Date().toISOString();
  const { focusedTarget, previousActiveTab } = await resolveRecordingTarget(tab, options);

  const firstFrame = await captureTabScreenshot(focusedTarget.tab.windowId);
  const dimensions = readPngDataUrlDimensions(firstFrame);
  const recordingId = `browser-recording-${Date.now().toString(36)}`;
  const filename = normalizeRecordingFilename(options.filename, focusedTarget.tab, startedAt);

  await sendMessageToRecordingOffscreen({
    type: "kuma-picker:recording-start",
    recordingId,
    fps: options.fps,
    speedMultiplier: options.speedMultiplier,
    width: dimensions.width,
    height: dimensions.height,
  });
  await sendMessageToRecordingOffscreen({
    type: "kuma-picker:recording-frame",
    recordingId,
    dataUrl: firstFrame,
  });

  const session = buildActiveRecordingSession({
    recordingId,
    focusedTarget,
    previousActiveTab,
    startedAt,
    filename,
    fps: options.fps,
    speedMultiplier: options.speedMultiplier,
  });
  recordingState.activeRecordingSession = session;
  await setRecordingOverlayMode(session.targetTabId, true);

  scheduleRecordingCapture(session, session.frameIntervalMs);

  return buildRecordingStartResult(session, focusedTarget, options);
}

async function stopTabRecording(tab) {
  const recordingState = getRecordingState();
  const session = recordingState.activeRecordingSession;
  if (!session) {
    throw new Error("No Kuma Picker browser recording is currently active.");
  }

  if (tab?.id !== session.targetTabId) {
    throw new Error(`The active recording belongs to tab ${session.targetTabId}, not tab ${tab?.id ?? "unknown"}.`);
  }

  session.stopping = true;
  clearRecordingTimer(session);

  const deferred = createDeferred();
  recordingState.pendingRecordingCompletions.set(session.id, deferred);

  try {
    await sendMessageToRecordingOffscreen({
      type: "kuma-picker:recording-stop",
      recordingId: session.id,
    });

    const result = await withTimeout(
      deferred.promise,
      RECORDING_TIMEOUT_MS,
      "Timed out waiting for the browser recording to finish encoding.",
    );
    const download = await downloadRecordedVideo(result, session.filename);

    return buildRecordingStopResult(session, tab, result, download);
  } finally {
    recordingState.pendingRecordingCompletions.delete(session.id);
    await setRecordingOverlayMode(session.targetTabId, false);
    await cleanupRecordingSession(session);
  }
}

async function handleRecordingFinished(message) {
  const recordingState = getRecordingState();
  const recordingId = typeof message?.recordingId === "string" ? message.recordingId : "";
  const pending = recordingState.pendingRecordingCompletions.get(recordingId);
  if (!pending) {
    return {
      ok: true,
      ignored: true,
    };
  }

  pending.resolve(normalizeRecordingCompletion(message));

  return {
    ok: true,
  };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const recordingState = getRecordingState();
  const session = recordingState.activeRecordingSession;
  if (session?.targetTabId === tabId) {
    const pending = recordingState.pendingRecordingCompletions.get(session.id);
    pending?.reject(new Error("The recorded browser tab was closed before the video finished."));
    recordingState.pendingRecordingCompletions.delete(session.id);
    void cleanupRecordingSession(session, { restorePreviousTab: false });
  }
});
