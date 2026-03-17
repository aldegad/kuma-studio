const COMMAND_INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  "label",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='option']",
  "[aria-controls]",
].join(", ");

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(", ");

const DOM_SNAPSHOT_LIMIT = 64;
const TEXT_SNIPPET_LIMIT = 2_000;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExtensionUiElement(element) {
  return Boolean(element?.closest?.(`[${UI_ATTRIBUTE}="true"]`));
}

function isVisibleElement(element) {
  if (!(element instanceof Element) || isExtensionUiElement(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return false;
  }

  const styles = window.getComputedStyle(element);
  return styles.display !== "none" && styles.visibility !== "hidden";
}

function describeElementForCommand(element) {
  const record = toSelectionElementRecord(element);

  return {
    tagName: record.tagName,
    role: record.role,
    selector: record.selector,
    selectorPath: record.selectorPath,
    textPreview: record.textPreview,
    rect: record.rect,
  };
}

function getCommandCandidates() {
  return Array.from(document.querySelectorAll(COMMAND_INTERACTIVE_SELECTOR)).filter(isVisibleElement);
}

function getAccessibleText(element) {
  return normalizeText(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ("value" in element ? element.value : "") ||
      element.textContent,
  );
}

function findElementBySelector(selector) {
  if (!selector) {
    return null;
  }

  try {
    const target = document.querySelector(selector);
    return isVisibleElement(target) ? target : target ?? null;
  } catch {
    return null;
  }
}

function findElementByText(text) {
  const normalizedNeedle = normalizeText(text);
  if (!normalizedNeedle) {
    return null;
  }

  const candidates = getCommandCandidates().map((element) => ({
    element,
    text: getAccessibleText(element),
  }));

  return (
    candidates.find((entry) => entry.text === normalizedNeedle)?.element ??
    candidates.find((entry) => entry.text.includes(normalizedNeedle))?.element ??
    null
  );
}

function resolveCommandTarget(command, options = {}) {
  const selectorTarget = findElementBySelector(command?.selectorPath) ?? findElementBySelector(command?.selector);
  if (selectorTarget) {
    return selectorTarget;
  }

  const textTarget = findElementByText(command?.text);
  if (textTarget) {
    return textTarget;
  }

  if (options.allowFocusedElement && document.activeElement instanceof Element) {
    return document.activeElement;
  }

  return null;
}

function getFocusedElementRecord() {
  return document.activeElement instanceof Element && isVisibleElement(document.activeElement)
    ? describeElementForCommand(document.activeElement)
    : null;
}

function buildDomSnapshot() {
  const interactiveElements = getCommandCandidates()
    .slice(0, DOM_SNAPSHOT_LIMIT)
    .map(describeElementForCommand);
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .filter(isVisibleElement)
    .slice(0, 12)
    .map((element) => ({
      tagName: element.tagName.toLowerCase(),
      text: normalizeText(element.textContent).slice(0, 240),
      selector: createSelector(element),
      selectorPath: createSelectorPath(element),
    }));

  return {
    page: buildPageRecord(),
    viewport: getViewportMetrics(),
    focusedElement: getFocusedElementRecord(),
    interactiveElements,
    headings,
    textExcerpt: normalizeText(document.body?.innerText ?? "").slice(0, TEXT_SNIPPET_LIMIT),
  };
}

function waitForDelay(ms) {
  if (!(Number.isFinite(ms) && ms > 0)) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    window.setTimeout(resolvePromise, ms);
  });
}

async function waitForPostActionDelay(command, fallbackMs) {
  const postActionDelayMs =
    typeof command?.postActionDelayMs === "number" && Number.isFinite(command.postActionDelayMs)
      ? Math.max(0, Math.min(10_000, Math.round(command.postActionDelayMs)))
      : fallbackMs;

  await waitForDelay(postActionDelayMs);
}

function focusElement(target) {
  target.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "auto",
  });
  target.focus?.({ preventScroll: true });
}

function dispatchMouseEvent(target, type, clientX, clientY) {
  const EventCtor = type.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  target.dispatchEvent(
    new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      view: window,
    }),
  );
}

function dispatchClickSequence(target, clientX, clientY) {
  dispatchMouseEvent(target, "pointerdown", clientX, clientY);
  dispatchMouseEvent(target, "mousedown", clientX, clientY);
  dispatchMouseEvent(target, "pointerup", clientX, clientY);
  dispatchMouseEvent(target, "mouseup", clientX, clientY);
  dispatchMouseEvent(target, "click", clientX, clientY);
}

function getPointTarget(command) {
  const x = Number(command?.x);
  const y = Number(command?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("The point click command requires finite x and y coordinates.");
  }

  const target = document.elementFromPoint(x, y);
  if (!(target instanceof Element) || isExtensionUiElement(target)) {
    throw new Error("Failed to find a clickable element at the requested viewport coordinates.");
  }

  return {
    x,
    y,
    target,
  };
}

function isTextInputElement(element) {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  if (!(element instanceof HTMLInputElement)) {
    return false;
  }

  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(
    element.type,
  );
}

function isFillableElement(element) {
  return (
    isTextInputElement(element) ||
    element instanceof HTMLSelectElement ||
    Boolean(element instanceof HTMLElement && element.isContentEditable)
  );
}

function setNativeValue(element, value) {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : null;
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;

  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return;
  }

  element.value = value;
}

function dispatchInputEvents(target, value) {
  const inputEvent =
    typeof InputEvent === "function"
      ? new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: value,
        })
      : new Event("input", {
          bubbles: true,
          composed: true,
        });

  target.dispatchEvent(inputEvent);
  target.dispatchEvent(
    new Event("change", {
      bubbles: true,
      composed: true,
    }),
  );
}

function getFocusableElements() {
  return Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisibleElement);
}

function moveFocus(shiftKey) {
  const focusable = getFocusableElements();
  if (focusable.length === 0) {
    return null;
  }

  const currentIndex = focusable.findIndex((element) => element === document.activeElement);
  const nextIndex =
    currentIndex < 0
      ? 0
      : (currentIndex + (shiftKey ? -1 : 1) + focusable.length) % focusable.length;
  const nextTarget = focusable[nextIndex];
  nextTarget.focus?.();
  return nextTarget;
}

function dispatchKeyboardEvent(target, type, key, shiftKey) {
  return target.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey,
    }),
  );
}

async function executeClickCommand(command) {
  const target = resolveCommandTarget(command);
  if (!(target instanceof Element)) {
    throw new Error("Failed to find a matching element to click in the active tab.");
  }

  focusElement(target);

  if (target instanceof HTMLElement) {
    target.click();
  } else {
    const rect = target.getBoundingClientRect();
    dispatchClickSequence(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  await waitForPostActionDelay(command, 400);

  return {
    page: buildPageRecord(),
    clickedElement: describeElementForCommand(target),
  };
}

async function executeClickPointCommand(command) {
  const { x, y, target } = getPointTarget(command);
  focusElement(target);
  dispatchClickSequence(target, x, y);
  await waitForPostActionDelay(command, 400);

  return {
    page: buildPageRecord(),
    clickPoint: { x, y },
    clickedElement: describeElementForCommand(target),
  };
}

async function executeFillCommand(command) {
  const target = resolveCommandTarget(command, { allowFocusedElement: true });
  if (!(target instanceof Element) || !isFillableElement(target)) {
    throw new Error("Failed to find a fillable input, textarea, select, or contenteditable target.");
  }

  const value = typeof command?.value === "string" ? command.value : "";
  focusElement(target);

  if (isTextInputElement(target)) {
    setNativeValue(target, value);
    if (typeof target.setSelectionRange === "function") {
      target.setSelectionRange(value.length, value.length);
    }
    dispatchInputEvents(target, value);
  } else if (target instanceof HTMLSelectElement) {
    target.value = value;
    dispatchInputEvents(target, value);
  } else if (target instanceof HTMLElement && target.isContentEditable) {
    target.textContent = value;
    dispatchInputEvents(target, value);
  }

  await waitForPostActionDelay(command, 100);

  return {
    page: buildPageRecord(),
    filledElement: describeElementForCommand(target),
    value,
  };
}

async function executeKeyCommand(command) {
  const key = normalizeText(command?.key);
  if (!key) {
    throw new Error("The key command requires a non-empty key.");
  }

  const shiftKey = command?.shiftKey === true;
  const target =
    resolveCommandTarget(command, { allowFocusedElement: true }) ??
    (document.body instanceof Element ? document.body : document.documentElement);

  if (!(target instanceof Element)) {
    throw new Error("Failed to find a target element for the keyboard command.");
  }

  target.focus?.({ preventScroll: true });
  dispatchKeyboardEvent(target, "keydown", key, shiftKey);
  dispatchKeyboardEvent(target, "keypress", key, shiftKey);

  let keyResult = null;

  if (key === "Tab") {
    const nextTarget = moveFocus(shiftKey);
    keyResult = nextTarget ? { focusedElement: describeElementForCommand(nextTarget) } : null;
  } else if (key === "Enter") {
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) {
      target.click();
    } else if (target instanceof HTMLElement && target.getAttribute("role") === "button") {
      target.click();
    } else if (target instanceof HTMLInputElement && target.form) {
      target.form.requestSubmit?.();
    }
  } else if (key === "Escape" && target instanceof HTMLElement) {
    target.blur();
  }

  dispatchKeyboardEvent(target, "keyup", key, shiftKey);
  await waitForPostActionDelay(command, 100);

  return {
    page: buildPageRecord(),
    key,
    shiftKey,
    targetElement: describeElementForCommand(target),
    ...keyResult,
  };
}

async function executeBrowserCommand(command) {
  switch (command?.type) {
    case "context":
      return {
        pageContext: buildPageContext(getPageTargetElement()),
      };
    case "dom":
      return {
        domSnapshot: buildDomSnapshot(),
      };
    case "click":
      return executeClickCommand(command);
    case "click-point":
      return executeClickPointCommand(command);
    case "fill":
      return executeFillCommand(command);
    case "key":
      return executeKeyCommand(command);
    default:
      throw new Error(`Unsupported Agent Picker browser command: ${String(command?.type)}`);
  }
}

globalThis.AgentPickerExtensionAgentActions = {
  executeBrowserCommand,
};
