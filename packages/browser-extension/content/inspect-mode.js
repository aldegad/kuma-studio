let isInspecting = false;
let hoveredElement = null;

function getTargetElement(input) {
  if (!input) return null;
  if (input instanceof Element) return input;
  if (input instanceof Node) return input.parentElement;
  return null;
}

function stopInspectMode() {
  isInspecting = false;
  hoveredElement = null;
  hideOverlay();
  setInspectSurfaceEnabled(false);

  const surface = getInspectSurfaceElement();
  surface.removeEventListener("mousemove", handleMouseMove);
  surface.removeEventListener("mousedown", handleMouseDown);
  surface.removeEventListener("click", handleClick);
  document.removeEventListener("keydown", handleKeyDown, true);
}

function startInspectMode() {
  if (isInspecting) {
    return;
  }

  ensureUi();
  isInspecting = true;
  showToast("Inspect mode on. Click the target element or press Esc.", "info");
  setInspectSurfaceEnabled(true);

  const surface = getInspectSurfaceElement();
  surface.addEventListener("mousemove", handleMouseMove);
  surface.addEventListener("mousedown", handleMouseDown);
  surface.addEventListener("click", handleClick);
  document.addEventListener("keydown", handleKeyDown, true);
}

function handleMouseMove(event) {
  if (!isInspecting) {
    return;
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
}

function handleClick(event) {
  if (!isInspecting) {
    return;
  }

  const target =
    getTargetElement(getUnderlyingElementFromPoint(event.clientX, event.clientY)) || hoveredElement;
  if (!target || isUiElement(target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  stopInspectMode();
  showToast("Saving the picked element...", "info");
  chrome.runtime.sendMessage({
    type: "agent-picker:inspect-picked",
    pageContext: buildPageContext(target),
  });
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
