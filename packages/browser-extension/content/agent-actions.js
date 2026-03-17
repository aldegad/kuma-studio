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
    label: record.label ?? null,
    selector: record.selector,
    selectorPath: record.selectorPath,
    textPreview: record.textPreview,
    value: record.value ?? null,
    valuePreview: record.valuePreview ?? null,
    checked: typeof record.checked === "boolean" ? record.checked : null,
    selectedValue: record.selectedValue ?? null,
    selectedValues: Array.isArray(record.selectedValues) ? record.selectedValues : [],
    placeholder: record.placeholder ?? null,
    required: record.required === true,
    disabled: record.disabled === true,
    readOnly: record.readOnly === true,
    multiple: record.multiple === true,
    inputType: record.inputType ?? null,
    rect: record.rect,
  };
}

function getCommandCandidates() {
  return Array.from(document.querySelectorAll(COMMAND_INTERACTIVE_SELECTOR)).filter(isVisibleElement);
}

function getAccessibleText(element) {
  return normalizeText(
    element.getAttribute("aria-label") ||
      getPrimaryLabel(element) ||
      element.getAttribute("title") ||
      ("value" in element ? element.value : "") ||
      element.textContent,
  );
}

function isFillableElement(element) {
  return (
    isTextInputElement(element) ||
    element instanceof HTMLSelectElement ||
    Boolean(element instanceof HTMLElement && element.isContentEditable)
  );
}

function getFillableElements(root = document) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => element instanceof Element && isVisibleElement(element) && isFillableElement(element),
  );
}

function scoreTextMatch(candidate, needle) {
  if (!candidate || !needle) {
    return 0;
  }

  if (candidate === needle) {
    return 3;
  }

  if (candidate.startsWith(needle)) {
    return 2;
  }

  if (candidate.includes(needle)) {
    return 1;
  }

  return 0;
}

function findBestFillableByLabel(labelText, root = document) {
  const normalizedNeedle = normalizeText(labelText);
  if (!normalizedNeedle) {
    return null;
  }

  const candidates = getFillableElements(root)
    .map((element) => {
      const labels = [];
      if (typeof getAssociatedLabelTexts === "function") {
        labels.push(...getAssociatedLabelTexts(element));
      }

      const normalizedLabels = labels.map((entry) => normalizeText(entry)).filter(Boolean);
      const score = normalizedLabels.reduce((best, entry) => Math.max(best, scoreTextMatch(entry, normalizedNeedle)), 0);
      return {
        element,
        score,
        label: normalizedLabels.find((entry) => scoreTextMatch(entry, normalizedNeedle) > 0) ?? normalizedLabels[0] ?? null,
        rect: element.getBoundingClientRect(),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.rect.top - right.rect.top || left.rect.left - right.rect.left);

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    const primaryRect = candidates[0].rect;
    const secondaryRect = candidates[1].rect;
    const closeTogether =
      Math.abs(primaryRect.top - secondaryRect.top) < 24 && Math.abs(primaryRect.left - secondaryRect.left) < 24;
    if (closeTogether) {
      throw new Error(`Multiple fillable fields matched the label "${labelText}". Add a selector for a more specific target.`);
    }
  }

  return candidates[0].element;
}

function getVisibleDialogs() {
  return Array.from(document.querySelectorAll("dialog[open], [role='dialog'], [aria-modal='true']")).filter(
    (element) => element instanceof Element && isVisibleElement(element),
  );
}

function getScopeRoot(scope) {
  if (scope === "dialog") {
    return getVisibleDialogs()[0] ?? null;
  }

  return document.body || document.documentElement;
}

function findElementByTextWithinRoot(text, root = document.body || document.documentElement) {
  const normalizedNeedle = normalizeText(text);
  if (!normalizedNeedle || !(root instanceof Element)) {
    return null;
  }

  const candidates = Array.from(root.querySelectorAll("*"))
    .filter((element) => isVisibleElement(element) && normalizeText(element.textContent).length > 0)
    .map((element) => ({
      element,
      text: normalizeText(element.textContent),
    }));

  return (
    candidates.find((entry) => entry.text === normalizedNeedle)?.element ??
    candidates.find((entry) => entry.text.includes(normalizedNeedle))?.element ??
    null
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

function resolveFillTarget(command) {
  const selectorTarget = findElementBySelector(command?.selectorPath) ?? findElementBySelector(command?.selector);
  if (selectorTarget && isFillableElement(selectorTarget)) {
    return selectorTarget;
  }

  if (typeof command?.label === "string" && command.label.trim()) {
    const labelTarget = findBestFillableByLabel(command.label);
    if (labelTarget) {
      return labelTarget;
    }
  }

  const textTarget = findElementByText(command?.text);
  if (textTarget && isFillableElement(textTarget)) {
    return textTarget;
  }

  if (document.activeElement instanceof Element && isFillableElement(document.activeElement)) {
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

function findElementBySelectorWithinRoot(selector, root) {
  if (!selector || !(root instanceof Element)) {
    return null;
  }

  try {
    const target = root.querySelector(selector);
    return isVisibleElement(target) ? target : null;
  } catch {
    return null;
  }
}

function getLastObservedSelectorState(selector, root) {
  if (!(root instanceof Element)) {
    return { present: false, visible: false };
  }

  try {
    const target = root.querySelector(selector);
    return {
      present: target instanceof Element,
      visible: isVisibleElement(target),
    };
  } catch {
    return { present: false, visible: false };
  }
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
  const target = resolveFillTarget(command);
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
    label: typeof command?.label === "string" ? normalizeText(command.label) || null : null,
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

function readTimeoutMs(command, fallbackMs = 15_000) {
  const timeoutMs =
    typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs)
      ? Math.max(100, Math.min(120_000, Math.round(command.timeoutMs)))
      : fallbackMs;
  return timeoutMs;
}

async function pollUntil(command, evaluator) {
  const timeoutMs = readTimeoutMs(command);
  const pollIntervalMs = 100;
  const startedAt = Date.now();
  let lastObserved = null;

  while (Date.now() - startedAt <= timeoutMs) {
    const observation = evaluator();
    lastObserved = observation?.lastObserved ?? lastObserved;
    if (observation?.matched) {
      return {
        matched: true,
        waitedMs: Date.now() - startedAt,
        ...observation.result,
      };
    }

    await waitForDelay(pollIntervalMs);
  }

  const details = lastObserved ? ` Last observed: ${JSON.stringify(lastObserved)}.` : "";
  const timeoutError = new Error(`Timed out after ${timeoutMs}ms.${details}`);
  timeoutError.lastObserved = lastObserved;
  throw timeoutError;
}

async function executeWaitForTextCommand(command, expectPresent) {
  const text = normalizeText(command?.text);
  if (!text) {
    throw new Error(expectPresent ? "browser-wait-for-text requires --text." : "browser-wait-for-text-disappear requires --text.");
  }

  const scopeRoot = getScopeRoot(command?.scope);
  if (!scopeRoot) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }

  const result = await pollUntil(command, () => {
    const haystack = normalizeText(scopeRoot.innerText || scopeRoot.textContent || "");
    const present = haystack.includes(text);
    return {
      matched: expectPresent ? present : !present,
      lastObserved: {
        text,
        present,
        scope: command?.scope === "dialog" ? "dialog" : "page",
      },
      result: {
        text,
        scope: command?.scope === "dialog" ? "dialog" : "page",
      },
    };
  });

  return {
    page: buildPageRecord(),
    ...result,
  };
}

async function executeWaitForSelectorCommand(command) {
  const selector = command?.selectorPath || command?.selector;
  if (!selector) {
    throw new Error("browser-wait-for-selector requires --selector or --selector-path.");
  }

  const scopeRoot = getScopeRoot(command?.scope);
  if (!scopeRoot) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }

  const result = await pollUntil(command, () => {
    const target = findElementBySelectorWithinRoot(selector, scopeRoot);
    return {
      matched: target instanceof Element,
      lastObserved: getLastObservedSelectorState(selector, scopeRoot),
      result: {
        selector,
        scope: command?.scope === "dialog" ? "dialog" : "page",
        element: target instanceof Element ? describeElementForCommand(target) : null,
      },
    };
  });

  return {
    page: buildPageRecord(),
    ...result,
  };
}

async function executeWaitForDialogCloseCommand(command) {
  const result = await pollUntil(command, () => {
    const dialogs = getVisibleDialogs();
    return {
      matched: dialogs.length === 0,
      lastObserved: {
        openDialogCount: dialogs.length,
      },
      result: {
        openDialogCount: dialogs.length,
      },
    };
  });

  return {
    page: buildPageRecord(),
    ...result,
  };
}

function serializeQueryResult(element) {
  const record = describeElementForCommand(element);
  return {
    label: record.label,
    tagName: record.tagName,
    role: record.role,
    selector: record.selector,
    selectorPath: record.selectorPath,
    required: record.required,
    placeholder: record.placeholder,
    valuePreview: record.valuePreview,
    rect: record.rect,
  };
}

function getQueryableRoot(scope) {
  const root = getScopeRoot(scope);
  if (!root) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }
  return root;
}

function queryRequiredFields(scope) {
  const root = getQueryableRoot(scope);
  return getFillableElements(root).filter(
    (element) =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? element.required || element.getAttribute("aria-required") === "true"
        : element.getAttribute("aria-required") === "true",
  );
}

function queryAllTextareas(scope) {
  const root = getQueryableRoot(scope);
  return Array.from(root.querySelectorAll("textarea")).filter(isVisibleElement);
}

function queryNearbyInput(scope, text) {
  const root = getQueryableRoot(scope);
  const target = findBestFillableByLabel(text, root) ?? (() => {
    const anchor = findElementByTextWithinRoot(text, root);
    if (!(anchor instanceof Element)) {
      return null;
    }

    let current = anchor instanceof HTMLLabelElement ? anchor : anchor.closest("label, fieldset, form, section, div");
    for (let depth = 0; depth < 3 && current; depth += 1) {
      const candidate = current.querySelector?.("input, textarea, select, [contenteditable='true']");
      if (candidate instanceof Element && isVisibleElement(candidate) && isFillableElement(candidate)) {
        return candidate;
      }
      current = current.parentElement;
    }

    return null;
  })();

  return target ? [target] : [];
}

async function executeQueryDomCommand(command) {
  const kind = normalizeText(command?.kind).toLowerCase();
  const scope = command?.scope === "dialog" ? "dialog" : "page";
  let elements = [];

  switch (kind) {
    case "required-fields":
      elements = queryRequiredFields(scope);
      break;
    case "all-textareas":
      elements = queryAllTextareas(scope);
      break;
    case "nearby-input": {
      const text = normalizeText(command?.text);
      if (!text) {
        throw new Error('browser-query-dom --kind nearby-input requires --text.');
      }
      elements = queryNearbyInput(scope, text);
      break;
    }
    default:
      throw new Error(`Unsupported browser-query-dom kind: ${String(command?.kind)}`);
  }

  return {
    page: buildPageRecord(),
    kind,
    scope,
    count: elements.length,
    results: elements.map(serializeQueryResult),
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
    case "wait-for-text":
      return executeWaitForTextCommand(command, true);
    case "wait-for-text-disappear":
      return executeWaitForTextCommand(command, false);
    case "wait-for-selector":
      return executeWaitForSelectorCommand(command);
    case "wait-for-dialog-close":
      return executeWaitForDialogCloseCommand(command);
    case "query-dom":
      return executeQueryDomCommand(command);
    default:
      throw new Error(`Unsupported Agent Picker browser command: ${String(command?.type)}`);
  }
}

globalThis.AgentPickerExtensionAgentActions = {
  executeBrowserCommand,
};
