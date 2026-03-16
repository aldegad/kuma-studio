(() => {
  const existingApi = globalThis.AgentPickerExtensionInteractive;
  if (existingApi?.version === 1) {
    return;
  }

  let rootElement = null;
  let shieldElement = null;
  let outlineElement = null;
  let labelElement = null;
  let toastElement = null;
  let toastTimerId = null;
  let isInspecting = false;
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

    rootElement.append(shieldElement, outlineElement, labelElement, toastElement);
    document.documentElement.appendChild(rootElement);
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

  function savePickedContext(pageContext, message, captureRect = null) {
    stopInspectMode();
    showToast(message, "info");
    const payload = {
      type: "agent-picker:inspect-picked",
      pageContext,
    };

    if (captureRect) {
      payload.captureRect = captureRect;
    }

    chrome.runtime.sendMessage(payload);
  }

  function stopInspectMode() {
    isInspecting = false;
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

  function startInspectMode() {
    if (isInspecting) {
      return;
    }

    ensureUi();
    isInspecting = true;
    showToast("Inspect mode on. Click an element or drag an area. Press Esc.", "info");
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

    const selectionRect = createRectFromPoints(dragStartPoint, getPoint(event));
    const target =
      getTargetElement(getUnderlyingElementFromPoint(event.clientX, event.clientY)) || hoveredElement;
    const didDrag = isDraggingArea || isAreaGesture(selectionRect);

    if (didDrag) {
      savePickedContext(
        buildAreaPageContext(selectionRect),
        "Saving the selected area...",
        selectionRect,
      );
      return;
    }

    if (!target || isUiElement(target)) {
      clearDragState();
      return;
    }

    savePickedContext(buildPageContext(target), "Saving the picked element...");
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
    if (!isInspecting || event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    stopInspectMode();
    showToast("Inspect mode cancelled.", "info");
    chrome.runtime.sendMessage({ type: "agent-picker:cancel-inspect" });
  }

  globalThis.AgentPickerExtensionInteractive = {
    version: 1,
    showToast,
    startInspectMode,
    stopInspectMode,
  };
})();
