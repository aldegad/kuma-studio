let rootElement = null;
let shieldElement = null;
let outlineElement = null;
let labelElement = null;
let toastElement = null;
let toastTimerId = null;

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
