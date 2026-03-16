let isInspecting = false;
let hoveredElement = null;
let dragStartPoint = null;
let isDraggingArea = false;

const DRAG_THRESHOLD_PX = 8;

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
