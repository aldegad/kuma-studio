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
  let isInspecting = false;
  let inspectMode = "standard";
  let hoveredElement = null;
  let dragStartPoint = null;
  let isDraggingArea = false;

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
    promptInputElement.placeholder = "Describe the job for this picked area or element.";
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
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        resolveJobPrompt(promptInputElement.value);
      }
    });
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

  function showToast(message, tone) {
    ensureUi();

    if (toastTimerId) {
      clearTimeout(toastTimerId);
    }

    toastElement.textContent = message;
    toastElement.style.background =
      tone === "error" ? "rgba(143, 47, 47, 0.96)" : "rgba(23, 36, 43, 0.94)";
    toastElement.style.opacity = "1";
    toastElement.style.transform = "translateY(0)";

    toastTimerId = window.setTimeout(() => {
      toastElement.style.opacity = "0";
      toastElement.style.transform = "translateY(6px)";
      toastTimerId = null;
    }, tone === "error" ? 2800 : 1800);
  }

  function setPromptVisible(visible) {
    ensureUi();
    promptElement.style.pointerEvents = visible ? "auto" : "none";
    promptElement.style.opacity = visible ? "1" : "0";
    promptElement.style.transform = visible ? "translate(-50%, 0)" : "translate(-50%, 8px)";
  }

  function resolveJobPrompt(value) {
    if (!pendingJobPromptResolve) {
      return;
    }

    const resolvePrompt = pendingJobPromptResolve;
    pendingJobPromptResolve = null;
    setPromptVisible(false);
    const message = typeof value === "string" ? value.trim() : "";
    promptInputElement.value = "";
    resolvePrompt(message || null);
  }

  function promptForJob() {
    ensureUi();

    if (pendingJobPromptResolve) {
      resolveJobPrompt(null);
    }

    promptInputElement.value = "";
    setPromptVisible(true);

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

  async function savePickedContext(pageContext, message, captureRect = null) {
    const nextInspectMode = inspectMode;
    stopInspectMode();
    let nextPageContext = pageContext;
    let nextMessage = message;
    if (nextInspectMode === "job") {
      const jobMessage = await promptForJob();
      if (!jobMessage) {
        showToast("Job entry cancelled.", "info");
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
  }

  function stopInspectMode() {
    isInspecting = false;
    inspectMode = "standard";
    hoveredElement = null;
    clearDragState();
    hideOverlay();
    setInspectSurfaceEnabled(false);

    const surface = getInspectSurfaceElement();
    surface.removeEventListener("mousemove", handleMouseMove);
    surface.removeEventListener("mousedown", handleMouseDown);
    surface.removeEventListener("mouseup", handleMouseUp);
    surface.removeEventListener("click", handleClick);
    document.removeEventListener("keydown", handleKeyDown, true);
  }

  function startInspectMode(options = {}) {
    if (isInspecting) {
      return;
    }

    ensureUi();
    isInspecting = true;
    inspectMode = options?.withJob === true ? "job" : "standard";
    showToast(
      inspectMode === "job"
        ? "Job pick mode on. Pick first, then write the job. Press Esc."
        : "Inspect mode on. Click an element or drag an area. Press Esc.",
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

    if (dragStartPoint) {
      const nextRect = createRectFromPoints(dragStartPoint, getPoint(event));
      if (isDraggingArea || isAreaGesture(nextRect)) {
        isDraggingArea = true;
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

    const releasePoint = getPoint(event);
    const selectionRect = createRectFromPoints(dragStartPoint, releasePoint);
    const target =
      getTargetElement(getUnderlyingElementFromPoint(event.clientX, event.clientY)) || hoveredElement;
    const didDrag = isDraggingArea || isAreaGesture(selectionRect);

    if (didDrag) {
      void savePickedContext(
        buildAreaPageContext(selectionRect, releasePoint),
        "Saving the selected area...",
        selectionRect,
      );
      return;
    }

    if (!target || isUiElement(target)) {
      clearDragState();
      return;
    }

    void savePickedContext(buildPageContext(target, releasePoint), "Saving the picked element...");
  }

  function handleClick(event) {
    if (!isInspecting) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function handleKeyDown(event) {
    if (pendingJobPromptResolve && event.key === "Escape") {
      event.preventDefault();
      resolveJobPrompt(null);
      return;
    }

    if (!isInspecting || event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    stopInspectMode();
    showToast("Inspect mode cancelled.", "info");
    chrome.runtime.sendMessage({ type: "kuma-picker:cancel-inspect" });
  }

  globalThis.KumaPickerExtensionInteractive = {
    version: 1,
    showToast,
    startInspectMode,
    stopInspectMode,
  };
})();
