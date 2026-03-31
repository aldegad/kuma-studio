const KumaPickerExtensionLiveCaptureSettings = (() => {
  const {
    LIVE_CAPTURE_SETTINGS_STORAGE_KEY,
  } = KumaPickerExtensionShared;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeSource(value) {
    return value === "window" || value === "screen" ? value : "tab";
  }

  function normalizeCompositionMode(value) {
    return value === "split" ? "split" : "single";
  }

  function normalizeActiveSection(value, compositionMode) {
    if (compositionMode === "split") {
      return value === "right" ? "right" : "left";
    }
    return "single";
  }

  function normalizeRatioRect(rect) {
    if (!rect || typeof rect !== "object") {
      return null;
    }

    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite)) {
      return null;
    }

    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      width: clamp(width, 0.01, 1),
      height: clamp(height, 0.01, 1),
    };
  }

  function createDefaultStudioSettings() {
    return {
      previewScalePercent: 100,
      compositionMode: "single",
      activeSectionId: "single",
      selectionRatios: {
        single: null,
        left: null,
        right: null,
      },
    };
  }

  function normalizeStudioSettings(value) {
    const candidate = value && typeof value === "object" ? value : {};
    const compositionMode = normalizeCompositionMode(candidate.compositionMode);
    const previewScalePercent = clamp(Math.round(Number(candidate.previewScalePercent) || 100), 80, 145);
    return {
      previewScalePercent,
      compositionMode,
      activeSectionId: normalizeActiveSection(candidate.activeSectionId, compositionMode),
      selectionRatios: {
        single: normalizeRatioRect(candidate.selectionRatios?.single),
        left: normalizeRatioRect(candidate.selectionRatios?.left),
        right: normalizeRatioRect(candidate.selectionRatios?.right),
      },
    };
  }

  function normalizeSettings(value) {
    const candidate = value && typeof value === "object" ? value : {};
    return {
      source: normalizeSource(candidate.source),
      studio: {
        window: normalizeStudioSettings(candidate.studio?.window),
        screen: normalizeStudioSettings(candidate.studio?.screen),
      },
    };
  }

  async function read() {
    const stored = await chrome.storage.local.get(LIVE_CAPTURE_SETTINGS_STORAGE_KEY);
    return normalizeSettings(stored[LIVE_CAPTURE_SETTINGS_STORAGE_KEY]);
  }

  async function write(settings) {
    const normalized = normalizeSettings(settings);
    await chrome.storage.local.set({
      [LIVE_CAPTURE_SETTINGS_STORAGE_KEY]: normalized,
    });
    return normalized;
  }

  async function writeSource(source) {
    const current = await read();
    current.source = normalizeSource(source);
    return write(current);
  }

  async function readStudioPreferences(captureKind) {
    const current = await read();
    return current.studio[captureKind === "window" ? "window" : "screen"];
  }

  async function writeStudioPreferences(captureKind, preferences) {
    const normalizedKind = captureKind === "window" ? "window" : "screen";
    const current = await read();
    current.studio[normalizedKind] = normalizeStudioSettings(preferences);
    return write(current);
  }

  return {
    createDefaultStudioSettings,
    normalizeCompositionMode,
    normalizeSettings,
    normalizeSource,
    read,
    readStudioPreferences,
    write,
    writeSource,
    writeStudioPreferences,
  };
})();
