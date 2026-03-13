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

  document.removeEventListener("mousemove", handleMouseMove, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("keydown", handleKeyDown, true);
}

function startInspectMode() {
  if (isInspecting) {
    return;
  }

  ensureUi();
  isInspecting = true;
  showToast("Inspect mode on. Click the target element or press Esc.", "info");

  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
}

function handleMouseMove(event) {
  if (!isInspecting) {
    return;
  }

  const target = document.elementFromPoint(event.clientX, event.clientY);
  hoveredElement = updateOverlay(target) ? target : null;
}

function handleClick(event) {
  if (!isInspecting) {
    return;
  }

  const target = getTargetElement(event.target) || hoveredElement;
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
