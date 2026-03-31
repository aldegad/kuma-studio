(() => {
  const existingApi = globalThis.KumaPickerExtensionInteractive;
  if (existingApi?.version === 1) {
    return;
  }

  let rootElement = null;
  let shieldElement = null;
  let outlineElement = null;
  let labelElement = null;
  let toastElement = null;
  let promptElement = null;
  let promptTitleElement = null;
  let promptInputElement = null;
  let promptCancelButton = null;
  let promptSaveButton = null;
  let toastTimerId = null;
  let pendingJobPromptResolve = null;
  let pendingJobEscListener = null;
  let isInspecting = false;
  let inspectMode = "standard";
  let hoveredElement = null;
  let dragStartPoint = null;
  let isDraggingArea = false;
  let isViewportPreviewActive = false;
  let isConfirmedState = false;
  let overlayEscListener = null; // ESC listener for dismissing post-pick overlays

  // --- Multi-selection state ---
  const multiSelections = []; // Array of { element, rect, overlayEl, closeEl, isArea, areaRect, pickedPoint }
  let clearAllBarElement = null;

  const DRAG_THRESHOLD_PX = 8;

  function isUiElement(element) {
    return Boolean(element?.closest?.(`[${UI_ATTRIBUTE}="true"]`));
  }

  function ensureUi() {
    if (rootElement) {
      return;
    }

    rootElement = document.createElement("div");
    rootElement.id = ROOT_ID;
    rootElement.setAttribute(UI_ATTRIBUTE, "true");
    rootElement.style.position = "fixed";
    rootElement.style.inset = "0";
    rootElement.style.pointerEvents = "none";
    rootElement.style.zIndex = "2147483646";

    shieldElement = document.createElement("div");
    shieldElement.setAttribute(UI_ATTRIBUTE, "true");
    shieldElement.style.position = "fixed";
    shieldElement.style.inset = "0";
    shieldElement.style.display = "none";
    shieldElement.style.pointerEvents = "none";
    shieldElement.style.cursor = "crosshair";
    shieldElement.style.background = "transparent";

    outlineElement = document.createElement("div");
    outlineElement.setAttribute(UI_ATTRIBUTE, "true");
    outlineElement.style.position = "fixed";
    outlineElement.style.border = "2px solid #25c69c";
    outlineElement.style.background = "rgba(37, 198, 156, 0.12)";
    outlineElement.style.boxShadow = "0 0 0 1px rgba(37, 198, 156, 0.18)";
    outlineElement.style.pointerEvents = "none";
    outlineElement.style.display = "none";

    labelElement = document.createElement("div");
    labelElement.setAttribute(UI_ATTRIBUTE, "true");
    labelElement.style.position = "fixed";
    labelElement.style.maxWidth = "280px";
    labelElement.style.padding = "6px 8px";
    labelElement.style.borderRadius = "10px";
    labelElement.style.background = "#17242b";
    labelElement.style.color = "#ffffff";
    labelElement.style.fontFamily = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    labelElement.style.fontSize = "11px";
    labelElement.style.fontWeight = "700";
    labelElement.style.lineHeight = "1.35";
    labelElement.style.boxShadow = "0 14px 28px rgba(15, 23, 42, 0.24)";
    labelElement.style.pointerEvents = "none";
    labelElement.style.display = "none";

    toastElement = document.createElement("div");
    toastElement.setAttribute(UI_ATTRIBUTE, "true");
    toastElement.style.position = "fixed";
    toastElement.style.right = "16px";
    toastElement.style.bottom = "16px";
    toastElement.style.maxWidth = "320px";
    toastElement.style.padding = "10px 14px";
    toastElement.style.borderRadius = "14px";
    toastElement.style.background = "rgba(23, 36, 43, 0.94)";
    toastElement.style.color = "#ffffff";
    toastElement.style.fontFamily = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    toastElement.style.fontSize = "12px";
    toastElement.style.lineHeight = "1.5";
    toastElement.style.boxShadow = "0 18px 36px rgba(15, 23, 42, 0.26)";
    toastElement.style.opacity = "0";
    toastElement.style.transform = "translateY(6px)";
    toastElement.style.transition = "opacity 120ms ease, transform 120ms ease";

    promptElement = document.createElement("div");
    promptElement.setAttribute(UI_ATTRIBUTE, "true");
    promptElement.style.position = "fixed";
    promptElement.style.left = "50%";
    promptElement.style.bottom = "20px";
    promptElement.style.width = "min(360px, calc(100vw - 32px))";
    promptElement.style.padding = "14px";
    promptElement.style.border = "1px solid rgba(32, 191, 143, 0.22)";
    promptElement.style.borderRadius = "18px";
    promptElement.style.background = "rgba(255, 255, 255, 0.98)";
    promptElement.style.boxShadow = "0 18px 36px rgba(15, 23, 42, 0.18)";
    promptElement.style.transform = "translate(-50%, 8px)";
    promptElement.style.opacity = "0";
    promptElement.style.pointerEvents = "none";
    promptElement.style.transition = "opacity 140ms ease, transform 140ms ease";
    promptElement.style.display = "grid";
    promptElement.style.gap = "10px";

    promptTitleElement = document.createElement("div");
    promptTitleElement.setAttribute(UI_ATTRIBUTE, "true");
    promptTitleElement.textContent = "What should the agent do here?";
    promptTitleElement.style.color = "#22313f";
    promptTitleElement.style.fontFamily = '"Pretendard", "SUIT", "IBM Plex Sans KR", "Segoe UI", sans-serif';
    promptTitleElement.style.fontSize = "13px";
    promptTitleElement.style.fontWeight = "700";
    promptTitleElement.style.lineHeight = "1.35";

    promptInputElement = document.createElement("textarea");
    promptInputElement.setAttribute(UI_ATTRIBUTE, "true");
    promptInputElement.rows = 3;
    promptInputElement.placeholder = "Describe the job here. Press Enter to save, Shift+Enter for a new line.";
    promptInputElement.style.width = "100%";
    promptInputElement.style.padding = "12px 13px";
    promptInputElement.style.border = "1px solid #dbe5ea";
    promptInputElement.style.borderRadius = "14px";
    promptInputElement.style.background = "#ffffff";
    promptInputElement.style.color = "#22313f";
    promptInputElement.style.fontFamily = '"Pretendard", "SUIT", "IBM Plex Sans KR", "Segoe UI", sans-serif';
    promptInputElement.style.fontSize = "13px";
    promptInputElement.style.lineHeight = "1.5";
    promptInputElement.style.resize = "none";

    const promptActionsElement = document.createElement("div");
    promptActionsElement.setAttribute(UI_ATTRIBUTE, "true");
    promptActionsElement.style.display = "flex";
    promptActionsElement.style.justifyContent = "flex-end";
    promptActionsElement.style.gap = "8px";

    promptCancelButton = document.createElement("button");
    promptCancelButton.setAttribute(UI_ATTRIBUTE, "true");
    promptCancelButton.type = "button";
    promptCancelButton.textContent = "Cancel";
    promptCancelButton.style.padding = "9px 12px";
    promptCancelButton.style.border = "1px solid #dbe5ea";
    promptCancelButton.style.borderRadius = "999px";
    promptCancelButton.style.background = "#ffffff";
    promptCancelButton.style.color = "#65727e";
    promptCancelButton.style.font = "600 12px/1.1 Pretendard, SUIT, IBM Plex Sans KR, Segoe UI, sans-serif";
    promptCancelButton.style.cursor = "pointer";

    promptSaveButton = document.createElement("button");
    promptSaveButton.setAttribute(UI_ATTRIBUTE, "true");
    promptSaveButton.type = "button";
    promptSaveButton.textContent = "Save Job";
    promptSaveButton.style.padding = "9px 14px";
    promptSaveButton.style.border = "1px solid #bfeedd";
    promptSaveButton.style.borderRadius = "999px";
    promptSaveButton.style.background = "#bfeedd";
    promptSaveButton.style.color = "#175846";
    promptSaveButton.style.font = "700 12px/1.1 Pretendard, SUIT, IBM Plex Sans KR, Segoe UI, sans-serif";
    promptSaveButton.style.cursor = "pointer";

    promptActionsElement.append(promptCancelButton, promptSaveButton);
    promptElement.append(promptTitleElement, promptInputElement, promptActionsElement);

    rootElement.append(shieldElement, outlineElement, labelElement, toastElement, promptElement);
    document.documentElement.appendChild(rootElement);

    promptCancelButton.addEventListener("click", () => {
      resolveJobPrompt(null);
    });

    promptSaveButton.addEventListener("click", () => {
      resolveJobPrompt(promptInputElement.value);
    });

    promptInputElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        resolveJobPrompt(promptInputElement.value);
      }
    });
  }

  // --- Multi-selection overlay helpers ---

  function createSelectionOverlay(rect, options = {}) {
    ensureUi();
    const { onClose } = options;

    const overlay = document.createElement("div");
    overlay.setAttribute(UI_ATTRIBUTE, "true");
    overlay.dataset.part = "selection-overlay";
    overlay.style.position = "fixed";
    overlay.style.left = `${rect.left ?? rect.x}px`;
    overlay.style.top = `${rect.top ?? rect.y}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.border = "2px solid #25c69c";
    overlay.style.background = "rgba(37, 198, 156, 0.10)";
    overlay.style.boxShadow = "0 0 0 1px rgba(37, 198, 156, 0.18)";
    overlay.style.pointerEvents = "auto";
    overlay.style.zIndex = "2147483646";
    overlay.style.boxSizing = "border-box";

    const closeBtn = document.createElement("button");
    closeBtn.setAttribute(UI_ATTRIBUTE, "true");
    closeBtn.dataset.part = "selection-overlay-close";
    closeBtn.type = "button";
    closeBtn.textContent = "\u00d7";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "-10px";
    closeBtn.style.right = "-10px";
    closeBtn.style.width = "20px";
    closeBtn.style.height = "20px";
    closeBtn.style.border = "1px solid #dbe5ea";
    closeBtn.style.borderRadius = "999px";
    closeBtn.style.background = "#ffffff";
    closeBtn.style.color = "#7d8a96";
    closeBtn.style.fontSize = "13px";
    closeBtn.style.lineHeight = "1";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.pointerEvents = "auto";
    closeBtn.style.display = "flex";
    closeBtn.style.alignItems = "center";
    closeBtn.style.justifyContent = "center";
    closeBtn.style.padding = "0";
    closeBtn.style.boxShadow = "0 2px 6px rgba(15, 23, 42, 0.12)";
    closeBtn.style.zIndex = "2147483647";

    // Prevent overlay interactions from reaching the shield's handlers underneath.
    overlay.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    overlay.addEventListener("mouseup", (e) => {
      e.stopPropagation();
    });
    overlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    });

    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (typeof onClose === "function") {
        onClose();
        return;
      }

      overlay.remove();
    });

    overlay.appendChild(closeBtn);
    rootElement.appendChild(overlay);

    return { overlayEl: overlay, closeEl: closeBtn };
  }

  function removeSelectionOverlays() {
    if (!rootElement) {
      return;
    }

    for (const overlayElement of rootElement.querySelectorAll('[data-part="selection-overlay"]')) {
      overlayElement.remove();
    }
  }

  /**
   * Install a document-level ESC listener that dismisses any lingering
   * selection overlays left after a pick completes (both standard and job
   * modes).  Only one such listener exists at a time.
   */
  function installOverlayEscListener() {
    removeOverlayEscListener();

    overlayEscListener = (event) => {
      const isEsc = event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
      if (!isEsc) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      removeSelectionOverlays();
      multiSelections.length = 0;
      updateClearAllBar();
      removeOverlayEscListener();
      showToast("Selection dismissed.", "info");
    };

    document.addEventListener("keydown", overlayEscListener, true);
  }

  function removeOverlayEscListener() {
    if (overlayEscListener) {
      document.removeEventListener("keydown", overlayEscListener, true);
      overlayEscListener = null;
    }
  }

  function hideJobPrompt() {
    if (!promptElement || !promptInputElement) {
      return;
    }

    setPromptVisible(false);
    promptInputElement.value = "";
  }

  function resetConfirmedState() {
    isConfirmedState = false;
    isInspecting = false;
    clearViewportPreview();
    hideOverlay();
    hideJobPrompt();
    setInspectSurfaceEnabled(false);

    const surface = getInspectSurfaceElement();
    surface.removeEventListener("mousemove", handleMouseMove);
    surface.removeEventListener("mousedown", handleMouseDown);
    surface.removeEventListener("mouseup", handleMouseUp);
    surface.removeEventListener("click", handleClick);
    document.removeEventListener("keydown", handleKeyDown, true);
    removeOverlayEscListener();
  }

  function ensureClearAllBar() {
    ensureUi();

    if (clearAllBarElement) {
      clearAllBarElement.style.display = multiSelections.length > 0 ? "flex" : "none";
      return;
    }

    clearAllBarElement = document.createElement("div");
    clearAllBarElement.setAttribute(UI_ATTRIBUTE, "true");
    clearAllBarElement.style.position = "fixed";
    clearAllBarElement.style.bottom = "16px";
    clearAllBarElement.style.left = "50%";
    clearAllBarElement.style.transform = "translateX(-50%)";
    clearAllBarElement.style.display = "flex";
    clearAllBarElement.style.alignItems = "center";
    clearAllBarElement.style.gap = "10px";
    clearAllBarElement.style.padding = "8px 16px";
    clearAllBarElement.style.borderRadius = "999px";
    clearAllBarElement.style.background = "rgba(23, 36, 43, 0.92)";
    clearAllBarElement.style.boxShadow = "0 14px 28px rgba(15, 23, 42, 0.22)";
    clearAllBarElement.style.pointerEvents = "auto";
    clearAllBarElement.style.zIndex = "2147483647";

    const countLabel = document.createElement("span");
    countLabel.setAttribute(UI_ATTRIBUTE, "true");
    countLabel.style.color = "#ffffff";
    countLabel.style.fontFamily = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    countLabel.style.fontSize = "12px";
    countLabel.style.fontWeight = "600";
    countLabel.dataset.part = "selection-count";

    const clearBtn = document.createElement("button");
    clearBtn.setAttribute(UI_ATTRIBUTE, "true");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear All";
    clearBtn.style.padding = "6px 12px";
    clearBtn.style.border = "1px solid rgba(255,255,255,0.2)";
    clearBtn.style.borderRadius = "999px";
    clearBtn.style.background = "rgba(255, 255, 255, 0.12)";
    clearBtn.style.color = "#ffffff";
    clearBtn.style.fontFamily = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    clearBtn.style.fontSize = "11px";
    clearBtn.style.fontWeight = "700";
    clearBtn.style.cursor = "pointer";

    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearAllSelections();

      if (isConfirmedState) {
        resetConfirmedState();
        chrome.runtime.sendMessage({ type: "kuma-picker:cancel-inspect" });
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.setAttribute(UI_ATTRIBUTE, "true");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.padding = "6px 12px";
    cancelBtn.style.border = "1px solid rgba(255,255,255,0.2)";
    cancelBtn.style.borderRadius = "999px";
    cancelBtn.style.background = "rgba(255, 255, 255, 0.12)";
    cancelBtn.style.color = "#ffffff";
    cancelBtn.style.fontFamily = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    cancelBtn.style.fontSize = "11px";
    cancelBtn.style.fontWeight = "700";
    cancelBtn.style.cursor = "pointer";

    cancelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCancelAction();
    });

    clearAllBarElement.append(countLabel, clearBtn, cancelBtn);
    rootElement.appendChild(clearAllBarElement);
  }

  function updateClearAllBar() {
    ensureClearAllBar();
    if (multiSelections.length > 0) {
      clearAllBarElement.style.display = "flex";
      const countLabel = clearAllBarElement.querySelector('[data-part="selection-count"]');
      if (countLabel) {
        countLabel.textContent = `${multiSelections.length} selected`;
      }
    } else {
      clearAllBarElement.style.display = "none";
    }
  }

  function addMultiSelection(entry) {
    const rect = entry.isArea
      ? { left: entry.areaRect.x, top: entry.areaRect.y, width: entry.areaRect.width, height: entry.areaRect.height }
      : entry.element.getBoundingClientRect();

    let selectionEntry = null;
    const { overlayEl, closeEl } = createSelectionOverlay(rect, {
      onClose: () => {
        if (selectionEntry) {
          removeMultiSelection(selectionEntry);
        }
      },
    });
    selectionEntry = { ...entry, overlayEl, closeEl, cachedRect: rect };
    multiSelections.push(selectionEntry);

    closeEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });

    updateClearAllBar();
  }

  function removeMultiSelection(entry) {
    const idx = multiSelections.indexOf(entry);
    if (idx !== -1) {
      multiSelections.splice(idx, 1);
    }
    if (entry.overlayEl) {
      entry.overlayEl.remove();
    }
    updateClearAllBar();

    if (multiSelections.length === 0) {
      if (isConfirmedState) {
        resetConfirmedState();
        chrome.runtime.sendMessage({ type: "kuma-picker:cancel-inspect" });
      }
      showToast("All selections cleared.", "info");
    }
  }

  function clearAllSelections({ showToastMessage = true } = {}) {
    for (const entry of [...multiSelections]) {
      if (entry.overlayEl) {
        entry.overlayEl.remove();
      }
    }
    multiSelections.length = 0;
    removeSelectionOverlays();
    updateClearAllBar();

    if (showToastMessage) {
      showToast("All selections cleared.", "info");
    }
  }

  function refreshSelectionOverlays() {
    for (const entry of multiSelections) {
      if (entry.isArea) {
        continue;
      }
      if (!entry.element || !entry.element.isConnected) {
        continue;
      }
      const rect = entry.element.getBoundingClientRect();
      entry.overlayEl.style.left = `${rect.left}px`;
      entry.overlayEl.style.top = `${rect.top}px`;
      entry.overlayEl.style.width = `${rect.width}px`;
      entry.overlayEl.style.height = `${rect.height}px`;
      entry.cachedRect = rect;
    }
  }

  // Periodically refresh overlay positions for element-based selections
  let selectionRefreshTimer = null;
  function startSelectionRefreshLoop() {
    if (selectionRefreshTimer) return;
    selectionRefreshTimer = window.setInterval(() => {
      if (multiSelections.length === 0) {
        window.clearInterval(selectionRefreshTimer);
        selectionRefreshTimer = null;
        return;
      }
      refreshSelectionOverlays();
    }, 500);
  }

  function getInspectSurfaceElement() {
    ensureUi();
    return shieldElement;
  }

  function setInspectSurfaceEnabled(enabled) {
    ensureUi();
    shieldElement.style.display = enabled ? "block" : "none";
    shieldElement.style.pointerEvents = enabled ? "auto" : "none";
  }

  function getUnderlyingElementFromPoint(clientX, clientY) {
    ensureUi();

    const previousPointerEvents = shieldElement.style.pointerEvents;
    shieldElement.style.pointerEvents = "none";
    const element = document.elementFromPoint(clientX, clientY);
    shieldElement.style.pointerEvents = previousPointerEvents;
    return element;
  }

  function hideOverlay() {
    if (outlineElement) {
      outlineElement.style.display = "none";
    }
    if (labelElement) {
      labelElement.style.display = "none";
    }
  }

  function placeLabel(left, top, text) {
    ensureUi();

    labelElement.style.display = "block";
    labelElement.textContent = text;
    labelElement.style.left = `${Math.max(8, Math.min(left, window.innerWidth - 288))}px`;
    labelElement.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 42))}px`;
  }

  function appendToastContent(message) {
    toastElement.replaceChildren();

    const KEY_PATTERN = /(Shift\+Click|Shift\+click|Shift\+Enter|Enter|Space|ESC|Esc)/g;
    const KEYCAP_SET = new Set(["Shift+Click", "Shift+click", "Shift+Enter", "Enter", "Space", "ESC", "Esc"]);
    const fragments = String(message ?? "").split(KEY_PATTERN);
    for (const fragment of fragments) {
      if (!fragment) {
        continue;
      }

      if (KEYCAP_SET.has(fragment)) {
        const badgeElement = document.createElement("span");
        badgeElement.setAttribute(UI_ATTRIBUTE, "true");
        badgeElement.textContent = fragment;
        badgeElement.style.display = "inline-flex";
        badgeElement.style.alignItems = "center";
        badgeElement.style.justifyContent = "center";
        badgeElement.style.margin = "0 2px";
        badgeElement.style.padding = fragment === "Space" ? "2px 8px" : "2px 7px";
        badgeElement.style.border = "1px solid rgba(15, 23, 42, 0.16)";
        badgeElement.style.borderRadius = "999px";
        badgeElement.style.background = "rgba(255, 255, 255, 0.98)";
        badgeElement.style.boxShadow = "inset 0 -1px 0 rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.14)";
        badgeElement.style.color = "#17242b";
        badgeElement.style.fontFamily = "SFMono-Regular, JetBrains Mono, Menlo, Consolas, monospace";
        badgeElement.style.fontSize = "11px";
        badgeElement.style.fontWeight = "700";
        badgeElement.style.lineHeight = "1.2";
        badgeElement.style.verticalAlign = "baseline";
        toastElement.appendChild(badgeElement);
        continue;
      }

      toastElement.appendChild(document.createTextNode(fragment));
    }
  }

  function showToast(message, tone) {
    ensureUi();

    if (toastTimerId) {
      clearTimeout(toastTimerId);
    }

    appendToastContent(message);
    toastElement.style.background =
      tone === "error" ? "rgba(143, 47, 47, 0.96)" : "rgba(23, 36, 43, 0.94)";
    toastElement.style.opacity = "1";
    toastElement.style.transform = "translateY(0)";

    toastTimerId = window.setTimeout(() => {
      toastElement.style.opacity = "0";
      toastElement.style.transform = "translateY(6px)";
      toastTimerId = null;
    }, tone === "error" ? 5600 : 3600);
  }

  function clampToViewport(left, top, width, height) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampedLeft = Math.max(12, Math.min(left, vw - width - 12));
    const clampedTop = Math.max(12, Math.min(top, vh - height - 12));
    return { left: clampedLeft, top: clampedTop };
  }

  function setPromptVisible(visible, anchorRect = null) {
    ensureUi();
    promptElement.style.pointerEvents = visible ? "auto" : "none";
    promptElement.style.opacity = visible ? "1" : "0";

    if (visible && anchorRect) {
      // Position prompt near the picked element with viewport clamping
      promptElement.style.left = "0";
      promptElement.style.bottom = "auto";
      promptElement.style.transform = "none";

      // Place below the picked element, offset by 12px
      const promptWidth = 360;
      const promptEstimatedHeight = 180;
      let targetLeft = anchorRect.left ?? anchorRect.x ?? 0;
      let targetTop = (anchorRect.top ?? anchorRect.y ?? 0) + (anchorRect.height ?? 0) + 12;

      const clamped = clampToViewport(targetLeft, targetTop, promptWidth, promptEstimatedHeight);
      // If placing below pushes it off screen, try placing above
      if (targetTop + promptEstimatedHeight > window.innerHeight - 12) {
        const aboveTop = (anchorRect.top ?? anchorRect.y ?? 0) - promptEstimatedHeight - 12;
        if (aboveTop >= 12) {
          clamped.top = aboveTop;
        }
      }

      promptElement.style.left = `${clamped.left}px`;
      promptElement.style.top = `${clamped.top}px`;
    } else if (visible) {
      // Default center-bottom positioning
      promptElement.style.left = "50%";
      promptElement.style.bottom = "20px";
      promptElement.style.top = "auto";
      promptElement.style.transform = "translate(-50%, 0)";
    } else {
      promptElement.style.left = "50%";
      promptElement.style.bottom = "20px";
      promptElement.style.top = "auto";
      promptElement.style.transform = "translate(-50%, 8px)";
    }
  }

  function resolveJobPrompt(value) {
    if (!pendingJobPromptResolve) {
      return;
    }

    // Remove the dedicated ESC listener (registered on window) before resolving.
    if (pendingJobEscListener) {
      window.removeEventListener("keydown", pendingJobEscListener, true);
      pendingJobEscListener = null;
    }

    const resolvePrompt = pendingJobPromptResolve;
    pendingJobPromptResolve = null;
    setPromptVisible(false);
    const message = typeof value === "string" ? value.trim() : "";
    promptInputElement.value = "";
    resolvePrompt(message || null);
  }

  function promptForJob(anchorRect = null) {
    ensureUi();

    if (pendingJobPromptResolve) {
      resolveJobPrompt(null);
    }

    promptInputElement.value = "";
    setPromptVisible(true, anchorRect);

    // Remove any stale ESC listener from a previous prompt.
    if (pendingJobEscListener) {
      window.removeEventListener("keydown", pendingJobEscListener, true);
      pendingJobEscListener = null;
    }

    // Register a dedicated ESC listener on **window** (not document) in capture
    // phase.  Window capture fires before document capture, so this handler
    // runs before handleKeyDown and any page-level listeners that might
    // swallow the event with stopImmediatePropagation().
    pendingJobEscListener = (event) => {
      const isEsc = event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
      if (isEsc) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        resolveJobPrompt(null);
      }
    };
    window.addEventListener("keydown", pendingJobEscListener, true);

    return new Promise((resolvePrompt) => {
      pendingJobPromptResolve = resolvePrompt;
      window.setTimeout(() => {
        promptInputElement.focus();
      }, 20);
    });
  }

  function updateOverlay(element) {
    ensureUi();

    if (!element || isUiElement(element)) {
      hideOverlay();
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      hideOverlay();
      return false;
    }

    outlineElement.style.display = "block";
    outlineElement.style.left = `${rect.left}px`;
    outlineElement.style.top = `${rect.top}px`;
    outlineElement.style.width = `${rect.width}px`;
    outlineElement.style.height = `${rect.height}px`;
    outlineElement.style.background = "rgba(37, 198, 156, 0.12)";
    outlineElement.style.boxShadow = "0 0 0 1px rgba(37, 198, 156, 0.18)";
    placeLabel(rect.left, rect.top - 30, `${element.tagName.toLowerCase()} ${createSelector(element)}`);
    return true;
  }

  function updateAreaOverlay(rect) {
    ensureUi();

    if (!rect || rect.width < 2 || rect.height < 2) {
      hideOverlay();
      return false;
    }

    outlineElement.style.display = "block";
    outlineElement.style.left = `${rect.x}px`;
    outlineElement.style.top = `${rect.y}px`;
    outlineElement.style.width = `${rect.width}px`;
    outlineElement.style.height = `${rect.height}px`;
    outlineElement.style.background = "rgba(37, 198, 156, 0.14)";
    outlineElement.style.boxShadow = "0 0 0 1px rgba(37, 198, 156, 0.18)";
    placeLabel(rect.x, rect.y - 30, `area ${Math.round(rect.width)} x ${Math.round(rect.height)}`);
    return true;
  }

  function getTargetElement(input) {
    if (!input) return null;
    if (input instanceof Element) return input;
    if (input instanceof Node) return input.parentElement;
    return null;
  }

  function getPoint(event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function createRectFromPoints(startPoint, endPoint) {
    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const right = Math.max(startPoint.x, endPoint.x);
    const bottom = Math.max(startPoint.y, endPoint.y);

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  function isAreaGesture(rect) {
    return rect.width >= DRAG_THRESHOLD_PX || rect.height >= DRAG_THRESHOLD_PX;
  }

  function clearDragState() {
    dragStartPoint = null;
    isDraggingArea = false;
  }

  function clearViewportPreview({ preserveOverlay = false } = {}) {
    isViewportPreviewActive = false;
    hoveredElement = null;
    clearDragState();

    if (!preserveOverlay) {
      hideOverlay();
    }
  }

  function buildViewportAreaSelection() {
    return {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function buildViewportPickedPoint(selectionRect) {
    return {
      x: Math.round(selectionRect.width / 2),
      y: Math.round(selectionRect.height / 2),
    };
  }

  function saveViewportSelection() {
    const selectionRect = buildViewportAreaSelection();
    const pickedPoint = buildViewportPickedPoint(selectionRect);
    const anchorRect = { x: window.innerWidth / 2 - 180, y: window.innerHeight / 2 - 90, width: 360, height: 180 };
    void savePickedContext(
      buildAreaPageContext(selectionRect, pickedPoint),
      inspectMode === "job" ? "Saving the whole page as a job..." : "Saving the whole page...",
      selectionRect,
      anchorRect,
    );
  }

  function saveSelectionContext(target, pickedPoint) {
    const rect = target.getBoundingClientRect();
    const anchorRect = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };

    // Create a persistent overlay so the user can see what was picked after
    // stopInspectMode() hides the hover outline.
    createSelectionOverlay(rect);

    void savePickedContext(
      buildPageContext(target, pickedPoint),
      "Saving the picked element...",
      null,
      anchorRect,
    );
  }

  function activateViewportPreview() {
    const selectionRect = buildViewportAreaSelection();
    isViewportPreviewActive = true;
    hoveredElement = null;
    clearDragState();
    updateAreaOverlay(selectionRect);
    showToast(
      inspectMode === "job"
        ? "Whole page selected. Click anywhere to save it, then write the job. Press Space or Esc to clear."
        : "Whole page selected. Click anywhere to save it. Press Space or Esc to clear.",
      "info",
    );
  }

  async function savePickedContext(pageContext, message, captureRect = null, anchorRect = null) {
    const nextInspectMode = inspectMode;
    stopInspectMode();
    let nextPageContext = pageContext;
    let nextMessage = message;
    if (nextInspectMode === "job") {
      // Re-add keydown listener so ESC can dismiss the job prompt.
      // stopInspectMode() removed it, but we still need it for the prompt.
      document.addEventListener("keydown", handleKeyDown, true);
      const jobMessage = await promptForJob(anchorRect);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (!jobMessage) {
        showToast("Job entry cancelled.", "info");
        removeSelectionOverlays();
        return;
      }

      const createdAt = new Date().toISOString();
      nextPageContext = {
        ...pageContext,
        job: {
          id: `job-${createdAt.replace(/[:.]/g, "-")}`,
          message: jobMessage,
          createdAt,
          author: "user",
          status: "noted",
        },
      };
      nextMessage = "Saving the picked job...";
    }

    showToast(nextMessage, "info");
    const payload = {
      type: "kuma-picker:inspect-picked",
      pageContext: nextPageContext,
    };

    if (captureRect) {
      payload.captureRect = captureRect;
    }

    chrome.runtime.sendMessage(payload);

    // Ensure ESC can dismiss lingering selection overlays regardless of mode.
    installOverlayEscListener();
  }

  async function saveMultiSelectionContext() {
    // Build a combined page context from all multi-selections
    if (multiSelections.length === 0) {
      return;
    }

    const elements = [];
    let firstAnchorRect = null;

    for (const sel of multiSelections) {
      if (sel.isArea) {
        elements.push(buildAreaPageContext(sel.areaRect, sel.pickedPoint));
        if (!firstAnchorRect) {
          firstAnchorRect = { x: sel.areaRect.x, y: sel.areaRect.y, width: sel.areaRect.width, height: sel.areaRect.height };
        }
      } else if (sel.element && sel.element.isConnected) {
        elements.push(buildPageContext(sel.element, sel.pickedPoint));
        if (!firstAnchorRect) {
          const r = sel.element.getBoundingClientRect();
          firstAnchorRect = { x: r.left, y: r.top, width: r.width, height: r.height };
        }
      }
    }

    if (elements.length === 0) {
      showToast("No valid selections to save.", "error");
      return;
    }

    // Use the first element as the primary context, attach all as multi-selection
    const primaryContext = elements[0];
    const combinedContext = {
      ...primaryContext,
      multiSelection: elements.map((ctx) => ctx.element),
    };

    const nextInspectMode = inspectMode;
    stopInspectMode();

    let nextPageContext = combinedContext;
    let nextMessage = "Saving multi-selection...";

    if (nextInspectMode === "job") {
      // Re-add keydown listener so ESC can dismiss the job prompt.
      // stopInspectMode() removed it, but we still need it for the prompt.
      document.addEventListener("keydown", handleKeyDown, true);
      const jobMessage = await promptForJob(firstAnchorRect);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (!jobMessage) {
        showToast("Job entry cancelled.", "info");
        clearAllSelections();
        return;
      }

      const createdAt = new Date().toISOString();
      nextPageContext = {
        ...combinedContext,
        job: {
          id: `job-${createdAt.replace(/[:.]/g, "-")}`,
          message: jobMessage,
          createdAt,
          author: "user",
          status: "noted",
        },
      };
      nextMessage = "Saving the multi-selection job...";
    }

    showToast(nextMessage, "info");
    const payload = {
      type: "kuma-picker:inspect-picked",
      pageContext: nextPageContext,
    };

    // Clear selections after save
    clearAllSelections();

    chrome.runtime.sendMessage(payload);
  }

  function stopInspectMode() {
    isInspecting = false;
    isConfirmedState = false;
    inspectMode = "standard";
    clearViewportPreview();
    hideOverlay();
    setInspectSurfaceEnabled(false);

    const surface = getInspectSurfaceElement();
    surface.removeEventListener("mousemove", handleMouseMove);
    surface.removeEventListener("mousedown", handleMouseDown);
    surface.removeEventListener("mouseup", handleMouseUp);
    surface.removeEventListener("click", handleClick);
    document.removeEventListener("keydown", handleKeyDown, true);
    removeOverlayEscListener();

    // Note: multi-selection overlays are NOT cleared here.
    // They persist until user explicitly clears them or they are consumed by save.
  }

  function startInspectMode(options = {}) {
    if (isInspecting) {
      return;
    }

    // Remove any stale overlay ESC listener from a previous pick session.
    removeOverlayEscListener();

    ensureUi();
    isInspecting = true;
    inspectMode = options?.withJob === true ? "job" : "standard";
    showToast(
      inspectMode === "job"
        ? "Job pick mode on. Pick first, then write the job. Shift+Click to multi-select. Press Space for whole page or Esc to cancel."
        : "Inspect mode on. Click an element, drag an area, or Shift+Click to multi-select. Press Space for whole page. Esc to cancel.",
      "info",
    );
    setInspectSurfaceEnabled(true);

    const surface = getInspectSurfaceElement();
    surface.addEventListener("mousemove", handleMouseMove);
    surface.addEventListener("mousedown", handleMouseDown);
    surface.addEventListener("mouseup", handleMouseUp);
    surface.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  function handleMouseMove(event) {
    if (!isInspecting) {
      return;
    }

    if (isViewportPreviewActive && !dragStartPoint) {
      return;
    }

    if (dragStartPoint) {
      const nextRect = createRectFromPoints(dragStartPoint, getPoint(event));
      if (isDraggingArea || isAreaGesture(nextRect)) {
        isDraggingArea = true;
        isViewportPreviewActive = false;
        hoveredElement = null;
        updateAreaOverlay(nextRect);
        return;
      }
    }

    const target = getUnderlyingElementFromPoint(event.clientX, event.clientY);
    hoveredElement = updateOverlay(target) ? target : null;
  }

  function handleMouseDown(event) {
    if (!isInspecting) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragStartPoint = getPoint(event);
    isDraggingArea = false;
  }

  function handleMouseUp(event) {
    if (!isInspecting) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (!dragStartPoint) {
      return;
    }

    if (isViewportPreviewActive) {
      saveViewportSelection();
      return;
    }

    const releasePoint = getPoint(event);
    const selectionRect = createRectFromPoints(dragStartPoint, releasePoint);
    const target =
      getTargetElement(getUnderlyingElementFromPoint(event.clientX, event.clientY)) || hoveredElement;
    const didDrag = isDraggingArea || isAreaGesture(selectionRect);
    const isShiftHeld = event.shiftKey;

    if (didDrag) {
      if (isShiftHeld) {
        // Shift+drag: add area to multi-selection
        addMultiSelection({
          element: null,
          isArea: true,
          areaRect: selectionRect,
          pickedPoint: releasePoint,
        });
        startSelectionRefreshLoop();
        clearDragState();
        showToast(
          `Area added to selection (${multiSelections.length} total). Shift+Click to add more, or press Enter or Esc to confirm.`,
          "info",
        );
        return;
      }

      // If there are pending multi-selections, plain drag confirms them all
      if (multiSelections.length > 0) {
        void saveMultiSelectionContext();
        return;
      }

      // Solo drag: save the area selection directly
      const anchorRect = { x: selectionRect.x, y: selectionRect.y, width: selectionRect.width, height: selectionRect.height };
      createSelectionOverlay(selectionRect);
      void savePickedContext(
        buildAreaPageContext(selectionRect, releasePoint),
        inspectMode === "job" ? "Saving the dragged area as a job..." : "Saving the dragged area...",
        selectionRect,
        anchorRect,
      );
      clearDragState();
      return;
    }

    if (!target || isUiElement(target)) {
      clearDragState();
      return;
    }

    if (isShiftHeld) {
      // Shift+click: add element to multi-selection
      addMultiSelection({
        element: target,
        isArea: false,
        areaRect: null,
        pickedPoint: releasePoint,
      });
      startSelectionRefreshLoop();
      clearDragState();
      showToast(
        `Element added to selection (${multiSelections.length} total). Shift+Click to add more, or press Enter or Esc to confirm.`,
        "info",
      );
      return;
    }

    // If there are pending multi-selections, plain click confirms them all
    if (multiSelections.length > 0) {
      void saveMultiSelectionContext();
      clearDragState();
      return;
    }

    saveSelectionContext(target, releasePoint);
    clearDragState();
  }

  function handleClick(event) {
    if (!isInspecting) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function handleCancelAction() {
    if (isConfirmedState) {
      clearAllSelections({ showToastMessage: false });
      resetConfirmedState();
      showToast("Inspect mode cancelled.", "info");
      chrome.runtime.sendMessage({ type: "kuma-picker:cancel-inspect" });
      return;
    }

    if (multiSelections.length > 0) {
      enterConfirmedState();
      return;
    }

    stopInspectMode();
    showToast("Inspect mode cancelled.", "info");
    chrome.runtime.sendMessage({ type: "kuma-picker:cancel-inspect" });
  }

  function enterConfirmedState() {
    if (isConfirmedState || multiSelections.length === 0) {
      return;
    }

    isConfirmedState = true;
    isInspecting = false;
    clearViewportPreview();
    hideOverlay();
    setInspectSurfaceEnabled(false);

    const surface = getInspectSurfaceElement();
    surface.removeEventListener("mousemove", handleMouseMove);
    surface.removeEventListener("mousedown", handleMouseDown);
    surface.removeEventListener("mouseup", handleMouseUp);
    surface.removeEventListener("click", handleClick);

    // Ensure the keydown listener is attached so ESC/Enter work in confirmed state.
    // Remove first to avoid duplicate registration, then re-add.
    document.removeEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    showToast("Selections confirmed. Press Enter to save as job, or ESC to clear all.", "info");
  }

  function handleKeyDown(event) {
    const isEscapePressed = event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
    const isConfirmedStateAction = isConfirmedState && (event.key === "Enter" || isEscapePressed);

    if (pendingJobPromptResolve && isEscapePressed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      resolveJobPrompt(null);
      return;
    }

    if (!isInspecting && !isConfirmedStateAction) {
      return;
    }

    if (event.key === " " || event.key === "Spacebar" || event.code === "Space") {
      if (!isInspecting) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (isViewportPreviewActive) {
        clearViewportPreview();
        showToast("Whole-page preview cleared.", "info");
        return;
      }

      activateViewportPreview();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (multiSelections.length > 0) {
        isConfirmedState = false;
        void saveMultiSelectionContext();
      }
      return;
    }

    if (!isEscapePressed) {
      return;
    }

    event.preventDefault();

    // 2nd ESC in confirmed state: clear everything
    if (isConfirmedState) {
      handleCancelAction();
      return;
    }

    if (isViewportPreviewActive) {
      clearViewportPreview();
      showToast("Whole-page preview cleared.", "info");
      return;
    }

    // 1st ESC with selections: enter confirmed state
    if (multiSelections.length > 0) {
      enterConfirmedState();
      return;
    }

    // No selections: exit immediately
    handleCancelAction();
  }

  globalThis.KumaPickerExtensionInteractive = {
    version: 1,
    showToast,
    startInspectMode,
    stopInspectMode,
    clearAllSelections,
  };
})();
