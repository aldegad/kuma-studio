(() => {
var {
  FOCUSABLE_SELECTOR: coreFocusableSelector,
  normalizeText: coreNormalizeText,
  isExtensionUiElement: coreIsExtensionUiElement,
  describeElementForCommand: coreDescribeElementForCommand,
  isVisibleElement: coreIsVisibleElement,
  isTextInputElement: coreIsTextInputElement,
  isFillableElement: coreIsFillableElement,
  resolveCommandTarget: coreResolveCommandTarget,
  resolveFillTarget: coreResolveFillTarget,
} = globalThis.KumaPickerExtensionAgentActionCore;

function getGestureOverlay() {
  return globalThis.KumaPickerExtensionAgentGestureOverlay ?? null;
}

var KumaPickerExtensionAgentActionInteraction = (() => {
  const POINT_INTERACTIVE_SELECTOR = [
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
    "[role='gridcell']",
    "[aria-controls]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");

  const pressedKeys = new Map();
  let shortcutClipboardText = "";
  let nextPointerHoldId = 1;
  let activePointerHolds = [];
  let activePointerState = {
    id: null,
    button: null,
    buttons: 0,
    target: null,
    lastPoint: null,
    downTarget: null,
    downPoint: null,
    moved: false,
  };

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

  function fireAndForgetGesture(task) {
    Promise.resolve()
      .then(task)
      .catch(() => {});
  }

  function isRectMostlyVisible(rect) {
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  }

  function readElementCenter(rect) {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  async function waitForAnimationFrames(count) {
    if (document.visibilityState !== "visible") {
      return;
    }

    for (let index = 0; index < count; index += 1) {
      await new Promise((resolvePromise) => {
        window.requestAnimationFrame(() => resolvePromise());
      });
    }
  }

  async function focusElement(target) {
    const beforeRect = target.getBoundingClientRect();
    if (document.activeElement === target && isRectMostlyVisible(beforeRect)) {
      return;
    }
    const shouldWatchScroll = !isRectMostlyVisible(beforeRect);
    if (shouldWatchScroll) {
      target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    }
    target.focus?.({ preventScroll: true });

    if (!shouldWatchScroll) {
      return;
    }

    await waitForAnimationFrames(2);

    const afterRect = target.getBoundingClientRect();
    const deltaY = afterRect.top - beforeRect.top;
    if (Math.abs(deltaY) >= 18) {
      fireAndForgetGesture(() =>
        getGestureOverlay()?.playScrollGesture?.({
          deltaY,
          center: readElementCenter(afterRect),
        }),
      );
    }
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
        ...(arguments.length > 4 && arguments[4] && typeof arguments[4] === "object" ? arguments[4] : null),
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

  function readClickOutcome(target) {
    return {
      page: buildPageRecord(),
      ariaSelected: target.getAttribute?.("aria-selected") ?? null,
      ariaExpanded: target.getAttribute?.("aria-expanded") ?? null,
      dataState: target.getAttribute?.("data-state") ?? null,
      open: target.hasAttribute?.("open") ?? false,
    };
  }

  function isLikelyNavigationClickTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (target instanceof HTMLAnchorElement && typeof target.href === "string" && target.href) {
      return true;
    }

    const anchor = target.closest?.("a[href]");
    return anchor instanceof HTMLAnchorElement && typeof anchor.href === "string" && anchor.href.length > 0;
  }

  function getPointTarget(command) {
    const x = Number(command?.x);
    const y = Number(command?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("The point click command requires finite x and y coordinates.");
    }

    const target = document.elementFromPoint(x, y);
    if (!(target instanceof Element) || coreIsExtensionUiElement(target)) {
      throw new Error("Failed to find a clickable element at the requested viewport coordinates.");
    }

    return { x, y, target };
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

  function dispatchInputEvents(target, value, inputType = "insertText") {
    const inputEvent =
      typeof InputEvent === "function"
        ? new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType,
            data: value,
          })
        : new Event("input", { bubbles: true, composed: true });

    target.dispatchEvent(inputEvent);
    target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function normalizeLineBreaks(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n");
  }

  function createContentEditableFragment(value) {
    const fragment = document.createDocumentFragment();
    const normalizedValue = normalizeLineBreaks(value);
    const lines = normalizedValue.split("\n");
    let lastNode = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length > 0) {
        lastNode = document.createTextNode(line);
        fragment.appendChild(lastNode);
      }

      if (index < lines.length - 1) {
        lastNode = document.createElement("br");
        fragment.appendChild(lastNode);
      }
    }

    return { fragment, lastNode };
  }

  function getFocusableElements() {
    return Array.from(document.querySelectorAll(coreFocusableSelector)).filter(coreIsVisibleElement);
  }

  function moveFocus(shiftKey) {
    const focusable = getFocusableElements();
    if (focusable.length === 0) {
      return null;
    }

    const currentIndex = focusable.findIndex((element) => element === document.activeElement);
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + (shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    const nextTarget = focusable[nextIndex];
    nextTarget.focus?.();
    return nextTarget;
  }

  function normalizeKeyboardCommandKey(rawKey) {
    const normalized = coreNormalizeText(rawKey);
    if (!normalized) {
      return null;
    }

    if (normalized === "Space" || normalized === "Spacebar") {
      return { key: " ", code: "Space" };
    }

    if (normalized === "Esc") {
      return { key: "Escape", code: "Escape" };
    }

    return { key: normalized, code: normalized.length === 1 ? `Key${normalized.toUpperCase()}` : normalized };
  }

  function readKeyboardModifiers(command, stored = null) {
    return {
      shiftKey: stored?.shiftKey ?? (command?.shiftKey === true),
      altKey: stored?.altKey ?? (command?.altKey === true),
      ctrlKey: stored?.ctrlKey ?? (command?.ctrlKey === true),
      metaKey: stored?.metaKey ?? (command?.metaKey === true),
    };
  }

  function isPrimaryShortcutModifier(modifiers) {
    return modifiers?.ctrlKey === true || modifiers?.metaKey === true;
  }

  async function writeShortcutClipboard(text) {
    shortcutClipboardText = typeof text === "string" ? text : "";
    try {
      await navigator.clipboard?.writeText?.(shortcutClipboardText);
    } catch {}
    return shortcutClipboardText;
  }

  async function readShortcutClipboard() {
    if (typeof shortcutClipboardText === "string" && shortcutClipboardText.length > 0) {
      return shortcutClipboardText;
    }

    try {
      const clipboardText = await navigator.clipboard?.readText?.();
      shortcutClipboardText = typeof clipboardText === "string" ? clipboardText : "";
    } catch {}

    return shortcutClipboardText;
  }

  function dispatchClipboardEvent(target, type, text) {
    const fallbackEvent = new Event(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
    });

    if (typeof ClipboardEvent !== "function" || typeof DataTransfer !== "function") {
      target.dispatchEvent(fallbackEvent);
      return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);

    try {
      const event = new ClipboardEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });
      if (!event.clipboardData) {
        Object.defineProperty(event, "clipboardData", { value: dataTransfer });
      }
      target.dispatchEvent(event);
    } catch {
      Object.defineProperty(fallbackEvent, "clipboardData", { value: dataTransfer });
      target.dispatchEvent(fallbackEvent);
    }
  }

  function readTextInputSelection(target) {
    if (!coreIsTextInputElement(target)) {
      return null;
    }

    const value = typeof target.value === "string" ? target.value : "";
    const selectionStart = typeof target.selectionStart === "number" ? target.selectionStart : value.length;
    const selectionEnd = typeof target.selectionEnd === "number" ? target.selectionEnd : selectionStart;
    const start = Math.max(0, Math.min(selectionStart, selectionEnd, value.length));
    const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), value.length));

    return {
      value,
      start,
      end,
      selectedText: value.slice(start, end),
    };
  }

  function replaceTextInputSelection(target, text, inputType) {
    const selection = readTextInputSelection(target);
    if (!selection) {
      return false;
    }

    const nextText = typeof text === "string" ? text : "";
    const nextValue = `${selection.value.slice(0, selection.start)}${nextText}${selection.value.slice(selection.end)}`;
    setNativeValue(target, nextValue);
    const nextCaret = selection.start + nextText.length;
    target.setSelectionRange?.(nextCaret, nextCaret);
    dispatchInputEvents(target, nextText, inputType);
    return true;
  }

  function readContentEditableSelection(target) {
    if (!(target instanceof HTMLElement) || !target.isContentEditable) {
      return null;
    }

    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) {
      return null;
    }

    return {
      selection,
      range,
      selectedText: selection.toString(),
    };
  }

  function ensureContentEditableSelection(target) {
    const existing = readContentEditableSelection(target);
    if (existing) {
      return existing;
    }

    if (!(target instanceof HTMLElement) || !target.isContentEditable) {
      return null;
    }

    const selection = window.getSelection?.();
    if (!selection) {
      return null;
    }

    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    return {
      selection,
      range,
      selectedText: "",
    };
  }

  function replaceContentEditableSelection(target, text, inputType) {
    const selectionState = ensureContentEditableSelection(target);
    if (!selectionState) {
      return false;
    }

    const { selection, range } = selectionState;
    range.deleteContents();
    const nextText = typeof text === "string" ? text : "";
    if (nextText.length > 0) {
      const { fragment, lastNode } = createContentEditableFragment(nextText);
      range.insertNode(fragment);
      if (lastNode) {
        range.setStartAfter(lastNode);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    dispatchInputEvents(target, nextText, inputType);
    return true;
  }

  function setContentEditableValue(target, value) {
    if (!(target instanceof HTMLElement) || !target.isContentEditable) {
      return false;
    }

    const nextValue = typeof value === "string" ? value : "";
    const { fragment, lastNode } = createContentEditableFragment(nextValue);
    target.replaceChildren(fragment);

    const selection = window.getSelection?.();
    if (!selection) {
      dispatchInputEvents(target, nextValue);
      return true;
    }

    const range = document.createRange();
    if (lastNode && target.contains(lastNode)) {
      range.setStartAfter(lastNode);
    } else {
      range.selectNodeContents(target);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    dispatchInputEvents(target, nextValue);
    return true;
  }

  function readShortcutSelectionText(target) {
    const textInputSelection = readTextInputSelection(target);
    if (textInputSelection) {
      return textInputSelection.selectedText;
    }

    const contentEditableSelection = readContentEditableSelection(target);
    if (contentEditableSelection) {
      return contentEditableSelection.selectedText;
    }

    return null;
  }

  function replaceShortcutSelection(target, text, inputType) {
    if (replaceTextInputSelection(target, text, inputType)) {
      return true;
    }

    return replaceContentEditableSelection(target, text, inputType);
  }

  function insertLineBreakAtSelection(target) {
    if (target instanceof HTMLTextAreaElement) {
      return replaceTextInputSelection(target, "\n", "insertLineBreak");
    }

    if (target instanceof HTMLElement && target.isContentEditable) {
      return replaceContentEditableSelection(target, "\n", "insertLineBreak");
    }

    return false;
  }

  function selectAllContent(target) {
    if (coreIsTextInputElement(target)) {
      const valueLength = typeof target.value === "string" ? target.value.length : 0;
      if (typeof target.setSelectionRange === "function") {
        target.setSelectionRange(0, valueLength);
      }
      return true;
    }

    if (target instanceof HTMLElement && target.isContentEditable) {
      const selection = window.getSelection?.();
      if (!selection) {
        return false;
      }
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    return false;
  }

  async function applyKeyboardShortcut(target, key, modifiers) {
    if (!isPrimaryShortcutModifier(modifiers)) {
      return null;
    }

    const normalizedKey = String(key).toLowerCase();
    if (normalizedKey === "a" && selectAllContent(target)) {
      return { shortcut: "select-all" };
    }

    if (normalizedKey === "c") {
      const copiedText = readShortcutSelectionText(target);
      if (copiedText == null) {
        return null;
      }
      dispatchClipboardEvent(target, "copy", copiedText);
      await writeShortcutClipboard(copiedText);
      return { shortcut: "copy", clipboardText: copiedText };
    }

    if (normalizedKey === "x") {
      const cutText = readShortcutSelectionText(target);
      if (cutText == null) {
        return null;
      }
      dispatchClipboardEvent(target, "cut", cutText);
      await writeShortcutClipboard(cutText);
      replaceShortcutSelection(target, "", "deleteByCut");
      return { shortcut: "cut", clipboardText: cutText };
    }

    if (normalizedKey === "v") {
      const clipboardText = await readShortcutClipboard();
      dispatchClipboardEvent(target, "paste", clipboardText);
      if (!replaceShortcutSelection(target, clipboardText, "insertFromPaste")) {
        return null;
      }
      return { shortcut: "paste", clipboardText };
    }

    return null;
  }

  function dispatchKeyboardEvent(target, type, key, modifiers, code) {
    return target.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
        composed: true,
        shiftKey: modifiers?.shiftKey === true,
        altKey: modifiers?.altKey === true,
        ctrlKey: modifiers?.ctrlKey === true,
        metaKey: modifiers?.metaKey === true,
      }),
    );
  }

  function shouldMirrorKeyboardEventToWindow(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (coreIsTextInputElement(target)) {
      return false;
    }

    return !(target instanceof HTMLElement && target.isContentEditable);
  }

  function dispatchKeyboardEventToWindow(type, key, modifiers, code) {
    return window.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code,
        bubbles: false,
        cancelable: true,
        composed: true,
        shiftKey: modifiers?.shiftKey === true,
        altKey: modifiers?.altKey === true,
        ctrlKey: modifiers?.ctrlKey === true,
        metaKey: modifiers?.metaKey === true,
      }),
    );
  }

  function resolveMouseButton(rawButton) {
    const normalized = coreNormalizeText(rawButton)?.toLowerCase?.() ?? "left";
    switch (normalized) {
      case "middle":
        return { name: "middle", button: 1, buttons: 4 };
      case "right":
        return { name: "right", button: 2, buttons: 2 };
      default:
        return { name: "left", button: 0, buttons: 1 };
    }
  }

  function readViewportPoint(command, actionName) {
    const x = Number(command?.x);
    const y = Number(command?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`${actionName} requires finite x and y coordinates.`);
    }

    return { x, y };
  }

  function getInteractivePointTarget(point, actionName) {
    const rawTarget = document.elementFromPoint(point.x, point.y);
    if (!(rawTarget instanceof Element) || coreIsExtensionUiElement(rawTarget)) {
      throw new Error(`Failed to find an interactive element for ${actionName} at the requested viewport coordinates.`);
    }

    const interactiveTarget =
      rawTarget.closest?.(POINT_INTERACTIVE_SELECTOR) instanceof Element ? rawTarget.closest(POINT_INTERACTIVE_SELECTOR) : rawTarget;
    if (!(interactiveTarget instanceof Element) || coreIsExtensionUiElement(interactiveTarget)) {
      throw new Error(`Failed to find an interactive element for ${actionName} at the requested viewport coordinates.`);
    }

    return interactiveTarget;
  }

  function shouldSynthesizeClick(downTarget, upTarget) {
    if (!(downTarget instanceof Element) || !(upTarget instanceof Element)) {
      return false;
    }

    return downTarget === upTarget || downTarget.contains(upTarget) || upTarget.contains(downTarget);
  }

  async function executeClickCommand(command) {
    const target = command?.targetElement instanceof Element ? command.targetElement : coreResolveCommandTarget(command);
    if (!(target instanceof Element)) {
      throw new Error("Failed to find a matching element to click in the active tab.");
    }

    await focusElement(target);
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const navigationLikely = isLikelyNavigationClickTarget(target);

    fireAndForgetGesture(() => getGestureOverlay()?.playClickGesture?.({ x: centerX, y: centerY }));

    if (target instanceof HTMLElement) {
      target.click();
    } else {
      dispatchClickSequence(target, centerX, centerY);
    }

    if (target instanceof HTMLElement && document.contains(target)) {
      target.focus?.({ preventScroll: true });
    }

    if (navigationLikely) {
      return {
        page: buildPageRecord(),
        clickedElement: coreDescribeElementForCommand(target),
        navigationLikely,
      };
    }

    await waitForPostActionDelay(command, 60);
    return {
      page: buildPageRecord(),
      clickedElement: coreDescribeElementForCommand(target),
      navigationLikely,
    };
  }

  async function executeClickPointCommand(command) {
    const { x, y } = getPointTarget(command);
    const target = getInteractivePointTarget({ x, y }, "click-point");
    await focusElement(target);
    fireAndForgetGesture(() => getGestureOverlay()?.playClickGesture?.({ x, y }));
    dispatchClickSequence(target, x, y);
    if (target instanceof HTMLElement && document.contains(target)) {
      target.focus?.({ preventScroll: true });
    }
    await waitForPostActionDelay(command, 60);

    return {
      page: buildPageRecord(),
      clickPoint: { x, y },
      clickedElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeFillCommand(command) {
    const target = command?.targetElement instanceof Element ? command.targetElement : coreResolveFillTarget(command);
    if (!(target instanceof Element) || !coreIsFillableElement(target)) {
      throw new Error("Failed to find a fillable input, textarea, select, or contenteditable target.");
    }

    const value = typeof command?.value === "string" ? command.value : "";
    await focusElement(target);
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    fireAndForgetGesture(() => getGestureOverlay()?.playClickGesture?.({ x: centerX, y: centerY }));

    if (coreIsTextInputElement(target)) {
      setNativeValue(target, value);
      if (typeof target.setSelectionRange === "function") {
        try {
          target.setSelectionRange(value.length, value.length);
        } catch {
          // Some input types like email throw here even though the value was set.
        }
      }
      dispatchInputEvents(target, value);
    } else if (target instanceof HTMLSelectElement) {
      target.value = value;
      dispatchInputEvents(target, value);
    } else if (target instanceof HTMLElement && target.isContentEditable) {
      setContentEditableValue(target, value);
    }

    await waitForPostActionDelay(command, 16);
    return {
      page: buildPageRecord(),
      filledElement: coreDescribeElementForCommand(target),
      label: typeof command?.label === "string" ? coreNormalizeText(command.label) || null : null,
      value,
    };
  }

  async function executeInsertTextCommand(command) {
    const target =
      coreResolveCommandTarget(command, { allowFocusedElement: true }) ??
      (document.activeElement instanceof Element
        ? document.activeElement
        : document.body instanceof Element
          ? document.body
          : document.documentElement);

    if (!(target instanceof Element) || (!coreIsTextInputElement(target) && !(target instanceof HTMLElement && target.isContentEditable))) {
      throw new Error("Failed to find a focused text input or contenteditable target for insert-text.");
    }

    const text = typeof command?.text === "string" ? command.text : typeof command?.value === "string" ? command.value : "";
    await focusElement(target);

    if (!replaceShortcutSelection(target, text, "insertText")) {
      throw new Error("Failed to insert text at the current cursor position.");
    }

    await waitForPostActionDelay(command, 16);
    return {
      page: buildPageRecord(),
      text,
      targetElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeKeyCommand(command) {
    const normalizedKey = normalizeKeyboardCommandKey(command?.key);
    if (!normalizedKey?.key) {
      throw new Error("The key command requires a non-empty key.");
    }

    const key = normalizedKey.key;
    const code = normalizedKey.code;
    const modifiers = readKeyboardModifiers(command);
    const holdMs =
      typeof command?.holdMs === "number" && Number.isFinite(command.holdMs)
        ? Math.max(0, Math.min(10_000, Math.round(command.holdMs)))
        : 0;
    const target =
      (command?.targetElement instanceof Element ? command.targetElement : null) ??
      coreResolveCommandTarget(command, { allowFocusedElement: true }) ??
      (document.body instanceof Element ? document.body : document.documentElement);

    if (!(target instanceof Element)) {
      throw new Error("Failed to find a target element for the keyboard command.");
    }

    await focusElement(target);
    dispatchKeyboardEvent(target, "keydown", key, modifiers, code);
    if (shouldMirrorKeyboardEventToWindow(target)) {
      dispatchKeyboardEventToWindow("keydown", key, modifiers, code);
    }
    if (!(modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey)) {
      dispatchKeyboardEvent(target, "keypress", key, modifiers, code);
      if (shouldMirrorKeyboardEventToWindow(target)) {
        dispatchKeyboardEventToWindow("keypress", key, modifiers, code);
      }
    }

    let keyResult = await applyKeyboardShortcut(target, key, modifiers);
    if (key === "Tab") {
      const nextTarget = moveFocus(modifiers.shiftKey === true);
      keyResult = nextTarget ? { ...(keyResult ?? {}), focusedElement: coreDescribeElementForCommand(nextTarget) } : keyResult;
    } else if (key === "Enter") {
      if (!(modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey) && insertLineBreakAtSelection(target)) {
        keyResult = { ...(keyResult ?? {}), shortcut: "insert-line-break" };
      } else if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) {
        target.click();
      } else if (target instanceof HTMLElement && target.getAttribute("role") === "button") {
        target.click();
      } else if (target instanceof HTMLInputElement && target.form) {
        target.form.requestSubmit?.();
      }
    } else if (key === "Escape" && target instanceof HTMLElement) {
      target.blur();
    }

    if (holdMs > 0) {
      await waitForDelay(holdMs);
    }

    dispatchKeyboardEvent(target, "keyup", key, modifiers, code);
    if (shouldMirrorKeyboardEventToWindow(target)) {
      dispatchKeyboardEventToWindow("keyup", key, modifiers, code);
    }
    await waitForPostActionDelay(command, 16);

    return {
      page: buildPageRecord(),
      key,
      code,
      ...modifiers,
      holdMs,
      targetElement: coreDescribeElementForCommand(target),
      ...keyResult,
    };
  }

  async function executeKeyDownCommand(command) {
    const normalizedKey = normalizeKeyboardCommandKey(command?.key);
    if (!normalizedKey?.key) {
      throw new Error("The keydown command requires a non-empty key.");
    }

    const target =
      (command?.targetElement instanceof Element ? command.targetElement : null) ??
      coreResolveCommandTarget(command, { allowFocusedElement: true }) ??
      (document.activeElement instanceof Element
        ? document.activeElement
        : document.body instanceof Element
          ? document.body
          : document.documentElement);

    if (!(target instanceof Element)) {
      throw new Error("Failed to find a target element for the keydown command.");
    }

    const modifiers = readKeyboardModifiers(command);
    await focusElement(target);
    dispatchKeyboardEvent(target, "keydown", normalizedKey.key, modifiers, normalizedKey.code);
    if (shouldMirrorKeyboardEventToWindow(target)) {
      dispatchKeyboardEventToWindow("keydown", normalizedKey.key, modifiers, normalizedKey.code);
    }
    const shortcutResult = await applyKeyboardShortcut(target, normalizedKey.key, modifiers);
    pressedKeys.set(normalizedKey.code, {
      key: normalizedKey.key,
      code: normalizedKey.code,
      ...modifiers,
      target,
    });
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      key: normalizedKey.key,
      code: normalizedKey.code,
      ...modifiers,
      targetElement: coreDescribeElementForCommand(target),
      ...(shortcutResult ?? {}),
    };
  }

  async function executeKeyUpCommand(command) {
    const normalizedKey = normalizeKeyboardCommandKey(command?.key);
    if (!normalizedKey?.key) {
      throw new Error("The keyup command requires a non-empty key.");
    }

    const stored = pressedKeys.get(normalizedKey.code) ?? null;
    const target =
      (stored?.target instanceof Element && document.contains(stored.target) ? stored.target : null) ??
      (command?.targetElement instanceof Element ? command.targetElement : null) ??
      coreResolveCommandTarget(command, { allowFocusedElement: true }) ??
      (document.activeElement instanceof Element
        ? document.activeElement
        : document.body instanceof Element
          ? document.body
          : document.documentElement);

    if (!(target instanceof Element)) {
      throw new Error("Failed to find a target element for the keyup command.");
    }

    const modifiers = readKeyboardModifiers(command, stored);
    dispatchKeyboardEvent(
      target,
      "keyup",
      stored?.key ?? normalizedKey.key,
      modifiers,
      stored?.code ?? normalizedKey.code,
    );
    if (shouldMirrorKeyboardEventToWindow(target)) {
      dispatchKeyboardEventToWindow(
        "keyup",
        stored?.key ?? normalizedKey.key,
        modifiers,
        stored?.code ?? normalizedKey.code,
      );
    }
    pressedKeys.delete(normalizedKey.code);
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      key: stored?.key ?? normalizedKey.key,
      code: stored?.code ?? normalizedKey.code,
      ...modifiers,
      targetElement: coreDescribeElementForCommand(target),
    };
  }

  function parseWaypoints(command) {
    const waypoints = command?.waypoints;
    if (Array.isArray(waypoints) && waypoints.length >= 2) {
      const parsed = waypoints.map((wp, i) => {
        const x = Number(wp?.x);
        const y = Number(wp?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error(`pointer-drag waypoint ${i + 1} requires finite x and y.`);
        }
        return { x, y };
      });
      return parsed;
    }

    const fromX = Number(command?.fromX ?? command?.from?.x);
    const fromY = Number(command?.fromY ?? command?.from?.y);
    const toX = Number(command?.toX ?? command?.to?.x);
    const toY = Number(command?.toY ?? command?.to?.y);

    if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) {
      throw new Error("pointer-drag requires finite from coordinates or waypoints.");
    }
    if (!Number.isFinite(toX) || !Number.isFinite(toY)) {
      throw new Error("pointer-drag requires finite to coordinates or waypoints.");
    }

    return [{ x: fromX, y: fromY }, { x: toX, y: toY }];
  }

  function computeSegmentLengths(waypoints) {
    const lengths = [];
    let total = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const dx = waypoints[i].x - waypoints[i - 1].x;
      const dy = waypoints[i].y - waypoints[i - 1].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      lengths.push(len);
      total += len;
    }
    return { lengths, total };
  }

  function interpolateWaypoints(waypoints, t) {
    if (t <= 0) return waypoints[0];
    if (t >= 1) return waypoints[waypoints.length - 1];

    const { lengths, total } = computeSegmentLengths(waypoints);
    if (total === 0) return waypoints[0];

    let targetDist = t * total;
    for (let i = 0; i < lengths.length; i++) {
      if (targetDist <= lengths[i]) {
        const segT = lengths[i] > 0 ? targetDist / lengths[i] : 0;
        return {
          x: waypoints[i].x + (waypoints[i + 1].x - waypoints[i].x) * segT,
          y: waypoints[i].y + (waypoints[i + 1].y - waypoints[i].y) * segT,
        };
      }
      targetDist -= lengths[i];
    }
    return waypoints[waypoints.length - 1];
  }

  function dispatchPointerEvent(target, type, clientX, clientY, extra) {
    const EventCtor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
    target.dispatchEvent(
      new EventCtor(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        view: window,
        ...extra,
      }),
    );
  }

  function getElementCenterPoint(target, fallbackPoint) {
    if (!(target instanceof Element)) {
      return fallbackPoint;
    }
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function resolveMouseCommandTarget(command, actionName) {
    const hasSelectorTargeting =
      (typeof command?.selector === "string" && command.selector.trim()) ||
      (typeof command?.selectorPath === "string" && command.selectorPath.trim()) ||
      (typeof command?.text === "string" && command.text.trim());
    const selectorTarget = hasSelectorTargeting ? coreResolveCommandTarget(command, { allowFocusedElement: false }) : null;
    if (selectorTarget instanceof Element) {
      const point = getElementCenterPoint(selectorTarget, { x: 0, y: 0 });
      return {
        target: selectorTarget,
        point,
        usesSelectorTarget: true,
      };
    }

    const point = readViewportPoint(command, actionName);
    return {
      target: getInteractivePointTarget(point, actionName),
      point,
      usesSelectorTarget: false,
    };
  }

  function findPointerHoldByTarget(target, button) {
    for (let index = activePointerHolds.length - 1; index >= 0; index -= 1) {
      const hold = activePointerHolds[index];
      if (hold.target === target && (button == null || hold.button === button)) {
        return hold;
      }
    }
    return null;
  }

  async function executePointerDragCommand(command) {
    const waypoints = parseWaypoints(command);
    const durationMs = Math.max(0, Math.min(10_000, Number(command?.durationMs) || 500));
    const steps = Math.max(
      2,
      Math.min(600, Math.round(Number(command?.steps) || durationMs / 16)),
    );
    const stepDelay = durationMs / steps;
    const start = waypoints[0];
    const end = waypoints[waypoints.length - 1];

    const target = document.elementFromPoint(start.x, start.y);
    if (!(target instanceof Element) || coreIsExtensionUiElement(target)) {
      throw new Error("Failed to find a draggable element at the pointer-drag start coordinates.");
    }

    await focusElement(target);
    const holdId = `drag-${nextPointerHoldId++}`;
    fireAndForgetGesture(() => getGestureOverlay()?.holdClickGesture?.(start, holdId));

    dispatchPointerEvent(target, "pointerdown", start.x, start.y, { button: 0, buttons: 1 });
    dispatchMouseEvent(target, "mousedown", start.x, start.y);
    await waitForAnimationFrames(1);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = interpolateWaypoints(waypoints, t);
      getGestureOverlay()?.moveHeldGesture?.(point, holdId);
      dispatchPointerEvent(target, "pointermove", point.x, point.y, { button: 0, buttons: 1 });
      dispatchMouseEvent(target, "mousemove", point.x, point.y);
      if (stepDelay > 0) {
        await waitForDelay(stepDelay);
      }
    }

    dispatchPointerEvent(target, "pointerup", end.x, end.y, { button: 0, buttons: 0 });
    dispatchMouseEvent(target, "mouseup", end.x, end.y);
    fireAndForgetGesture(() => getGestureOverlay()?.releaseHeldGesture?.(end, holdId));

    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      dragFrom: start,
      dragTo: end,
      waypointCount: waypoints.length,
      durationMs,
      steps,
    };
  }

  async function executeMouseMoveCommand(command) {
    const point = readViewportPoint(command, "mousemove");
    const target =
      activePointerState.buttons > 0 &&
      activePointerState.target instanceof Element &&
      document.contains(activePointerState.target)
        ? activePointerState.target
        : getInteractivePointTarget(point, "mousemove");

    dispatchPointerEvent(target, "pointermove", point.x, point.y, {
      button: activePointerState.button ?? 0,
      buttons: activePointerState.buttons ?? 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
    dispatchMouseEvent(target, "mousemove", point.x, point.y, {
      button: activePointerState.button ?? 0,
      buttons: activePointerState.buttons ?? 0,
    });

    activePointerState = {
      ...activePointerState,
      lastPoint: point,
      target,
      moved:
        activePointerState.moved ||
        (activePointerState.downPoint != null &&
          (Math.abs(point.x - activePointerState.downPoint.x) > 3 ||
            Math.abs(point.y - activePointerState.downPoint.y) > 3)),
    };
    if ((activePointerState.buttons ?? 0) > 0) {
      getGestureOverlay()?.moveHeldGesture?.(getElementCenterPoint(target, point), activePointerState.id ?? "default");
      activePointerHolds = activePointerHolds.map((hold) =>
        hold.id === activePointerState.id
          ? {
              ...hold,
              lastPoint: point,
              target,
              moved:
                hold.moved ||
                (hold.downPoint != null &&
                  (Math.abs(point.x - hold.downPoint.x) > 3 || Math.abs(point.y - hold.downPoint.y) > 3)),
            }
          : hold,
      );
    }
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      point,
      buttons: activePointerState.buttons ?? 0,
      targetElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeMouseDownCommand(command) {
    const buttonInfo = resolveMouseButton(command?.button);
    const { point, target } = resolveMouseCommandTarget(command, "mousedown");
    const gesturePoint = getElementCenterPoint(target, point);
    const holdId = `hold-${nextPointerHoldId++}`;

    await focusElement(target);
    fireAndForgetGesture(() => getGestureOverlay()?.holdClickGesture?.(gesturePoint, holdId));

    dispatchPointerEvent(target, "pointerdown", point.x, point.y, {
      button: buttonInfo.button,
      buttons: buttonInfo.buttons,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
    dispatchMouseEvent(target, "mousedown", point.x, point.y, {
      button: buttonInfo.button,
      buttons: buttonInfo.buttons,
    });

    const holdState = {
      id: holdId,
      button: buttonInfo.button,
      buttons: buttonInfo.buttons,
      target,
      lastPoint: point,
      downTarget: target,
      downPoint: point,
      moved: false,
    };
    activePointerHolds = [...activePointerHolds, holdState];
    activePointerState = holdState;
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      point,
      button: buttonInfo.name,
      targetElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeMouseUpCommand(command) {
    const fallbackButtonInfo = resolveMouseButton(command?.button);
    const { point, target: resolvedTarget, usesSelectorTarget } = resolveMouseCommandTarget(command, "mouseup");
    const releaseTarget = usesSelectorTarget ? resolvedTarget : getInteractivePointTarget(point, "mouseup");
    const holdState =
      findPointerHoldByTarget(resolvedTarget, fallbackButtonInfo.button) ??
      (activePointerState.id != null ? activePointerHolds.find((hold) => hold.id === activePointerState.id) ?? null : null);
    const target =
      holdState?.target instanceof Element && document.contains(holdState.target)
        ? holdState.target
        : releaseTarget;
    const button =
      typeof holdState?.button === "number"
        ? holdState.button
        : fallbackButtonInfo.button;
    const buttonName =
      (holdState?.buttons ?? activePointerState.buttons) > 0
        ? button === 2
          ? "right"
          : button === 1
            ? "middle"
            : "left"
        : fallbackButtonInfo.name;
    const gesturePoint = getElementCenterPoint(target, point);

    dispatchPointerEvent(target, "pointerup", point.x, point.y, {
      button,
      buttons: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
    dispatchMouseEvent(target, "mouseup", point.x, point.y, {
      button,
      buttons: 0,
    });
    fireAndForgetGesture(() =>
      getGestureOverlay()?.releaseHeldGesture?.(gesturePoint, holdState?.id ?? activePointerState.id ?? "default"),
    );

    const synthesizedClick =
      button === 0 &&
      !(holdState?.moved ?? activePointerState.moved) &&
      shouldSynthesizeClick(holdState?.downTarget ?? activePointerState.downTarget, releaseTarget);
    if (synthesizedClick) {
      dispatchMouseEvent(target, "click", point.x, point.y, {
        button,
        buttons: 0,
        detail: 1,
      });
    }

    activePointerHolds = activePointerHolds.filter((hold) => hold.id !== holdState?.id);
    activePointerState =
      activePointerHolds.at(-1) ?? {
        id: null,
        button: null,
        buttons: 0,
        target: null,
        lastPoint: point,
        downTarget: null,
        downPoint: null,
        moved: false,
      };
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      point,
      button: buttonName,
      targetElement: coreDescribeElementForCommand(target),
      synthesizedClick,
    };
  }


  async function executeHoverCommand(command) {
    const target = command?.targetElement instanceof Element ? command.targetElement : coreResolveCommandTarget(command);
    if (!(target instanceof Element)) {
      throw new Error("Failed to find a matching element to hover in the active tab.");
    }

    await focusElement(target);
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    fireAndForgetGesture(() => getGestureOverlay()?.playClickGesture?.({ x: centerX, y: centerY }));

    dispatchMouseEvent(target, "pointerover", centerX, centerY);
    dispatchMouseEvent(target, "pointerenter", centerX, centerY);
    dispatchMouseEvent(target, "mouseover", centerX, centerY);
    dispatchMouseEvent(target, "mouseenter", centerX, centerY);
    dispatchMouseEvent(target, "pointermove", centerX, centerY);
    dispatchMouseEvent(target, "mousemove", centerX, centerY);

    await waitForPostActionDelay(command, 60);
    return {
      page: buildPageRecord(),
      hoveredElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeDblClickCommand(command) {
    const target = command?.targetElement instanceof Element ? command.targetElement : coreResolveCommandTarget(command);
    if (!(target instanceof Element)) {
      throw new Error("Failed to find a matching element to double-click in the active tab.");
    }

    await focusElement(target);
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    fireAndForgetGesture(() => getGestureOverlay()?.playClickGesture?.({ x: centerX, y: centerY }));

    dispatchMouseEvent(target, "pointerdown", centerX, centerY, { detail: 1 });
    dispatchMouseEvent(target, "mousedown", centerX, centerY, { detail: 1 });
    dispatchMouseEvent(target, "pointerup", centerX, centerY, { detail: 1 });
    dispatchMouseEvent(target, "mouseup", centerX, centerY, { detail: 1 });
    dispatchMouseEvent(target, "click", centerX, centerY, { detail: 1 });
    dispatchMouseEvent(target, "pointerdown", centerX, centerY, { detail: 2 });
    dispatchMouseEvent(target, "mousedown", centerX, centerY, { detail: 2 });
    dispatchMouseEvent(target, "pointerup", centerX, centerY, { detail: 2 });
    dispatchMouseEvent(target, "mouseup", centerX, centerY, { detail: 2 });
    dispatchMouseEvent(target, "click", centerX, centerY, { detail: 2 });
    dispatchMouseEvent(target, "dblclick", centerX, centerY, { detail: 2 });

    if (target instanceof HTMLElement && document.contains(target)) {
      target.focus?.({ preventScroll: true });
    }

    await waitForPostActionDelay(command, 60);
    return {
      page: buildPageRecord(),
      dblClickedElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeMouseWheelCommand(command) {
    const deltaX = Number.isFinite(command?.deltaX) ? command.deltaX : 0;
    const deltaY = Number.isFinite(command?.deltaY) ? command.deltaY : 0;

    const targetX = Number.isFinite(command?.x) ? command.x : window.innerWidth / 2;
    const targetY = Number.isFinite(command?.y) ? command.y : window.innerHeight / 2;

    const target = document.elementFromPoint(targetX, targetY) || document.documentElement;

    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: targetX,
      clientY: targetY,
      deltaX,
      deltaY,
      deltaMode: 0,
      view: window,
    });
    target.dispatchEvent(wheelEvent);

    window.scrollBy(deltaX, deltaY);

    await waitForPostActionDelay(command, 60);
    return {
      page: buildPageRecord(),
      deltaX,
      deltaY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }

  async function executeDragAndDropCommand(command) {
    const sourceElement = command?.sourceElement;
    const targetElement = command?.targetElement;

    if (!(sourceElement instanceof Element)) {
      throw new Error("drag-and-drop requires a valid source element.");
    }
    if (!(targetElement instanceof Element)) {
      throw new Error("drag-and-drop requires a valid target element.");
    }

    await focusElement(sourceElement);
    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const sourceX = sourceRect.left + sourceRect.width / 2;
    const sourceY = sourceRect.top + sourceRect.height / 2;
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;

    const dataTransfer = typeof DataTransfer === "function" ? new DataTransfer() : null;
    const dragEventInit = (type, clientX, clientY, extra) => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      view: window,
      dataTransfer,
      ...extra,
    });

    const pointerEventInit = (clientX, clientY) => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      view: window,
      pointerId: 1,
      pointerType: "mouse",
    });
    const mouseEventInit = (clientX, clientY) => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      view: window,
      button: 0,
    });

    // Full drag-and-drop sequence for React DnD and native HTML5 compatibility
    sourceElement.dispatchEvent(new PointerEvent("pointerdown", pointerEventInit(sourceX, sourceY)));
    sourceElement.dispatchEvent(new MouseEvent("mousedown", mouseEventInit(sourceX, sourceY)));

    sourceElement.dispatchEvent(new DragEvent("dragstart", dragEventInit("dragstart", sourceX, sourceY)));
    sourceElement.dispatchEvent(new DragEvent("drag", dragEventInit("drag", sourceX, sourceY)));

    // Intermediate mousemove to trigger drag recognition
    sourceElement.dispatchEvent(new MouseEvent("mousemove", mouseEventInit(
      sourceX + (targetX - sourceX) / 2,
      sourceY + (targetY - sourceY) / 2,
    )));

    targetElement.dispatchEvent(new DragEvent("dragenter", dragEventInit("dragenter", targetX, targetY)));
    targetElement.dispatchEvent(new DragEvent("dragover", dragEventInit("dragover", targetX, targetY)));
    targetElement.dispatchEvent(new DragEvent("drop", dragEventInit("drop", targetX, targetY)));

    sourceElement.dispatchEvent(new DragEvent("dragend", dragEventInit("dragend", targetX, targetY)));
    sourceElement.dispatchEvent(new PointerEvent("pointerup", pointerEventInit(targetX, targetY)));
    sourceElement.dispatchEvent(new MouseEvent("mouseup", mouseEventInit(targetX, targetY)));

    await waitForPostActionDelay(command, 60);
    return {
      page: buildPageRecord(),
      sourceElement: coreDescribeElementForCommand(sourceElement),
      targetElement: coreDescribeElementForCommand(targetElement),
    };
  }

  async function executeSetInputFilesCommand(command) {
    const target = command?.targetElement;
    if (!(target instanceof HTMLInputElement) || target.type !== "file") {
      throw new Error("setInputFiles requires an input[type='file'] element.");
    }

    const files = command?.files;
    if (!Array.isArray(files)) {
      throw new Error("setInputFiles requires an array of file descriptors.");
    }

    const dataTransfer = new DataTransfer();
    for (const fileDesc of files) {
      const name = typeof fileDesc?.name === "string" ? fileDesc.name : "file";
      const type = typeof fileDesc?.type === "string" ? fileDesc.type : "application/octet-stream";
      let content;
      if (typeof fileDesc?.content === "string") {
        content = new TextEncoder().encode(fileDesc.content);
      } else if (fileDesc?.base64 && typeof fileDesc.base64 === "string") {
        try {
          const binaryString = atob(fileDesc.base64);
          content = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            content[i] = binaryString.charCodeAt(i);
          }
        } catch (decodeError) {
          console.warn(`[kuma-picker] Skipping file "${name}": invalid base64 data -`, decodeError.message);
          continue;
        }
      } else {
        content = new Uint8Array(0);
      }
      const file = new File([content], name, { type });
      dataTransfer.items.add(file);
    }

    try {
      target.files = dataTransfer.files;
    } catch {
      Object.defineProperty(target, "files", {
        value: dataTransfer.files,
        writable: true,
        configurable: true,
      });
    }

    target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    await waitForPostActionDelay(command, 16);
    return {
      page: buildPageRecord(),
      fileCount: files.length,
      fileNames: files.map((f) => f?.name ?? "file"),
      targetElement: coreDescribeElementForCommand(target),
    };
  }


  return {
    waitForDelay,
    executeClickCommand,
    executeClickPointCommand,
    executeFillCommand,
    executeInsertTextCommand,
    executeKeyCommand,
    executeKeyDownCommand,
    executeKeyUpCommand,
    executeMouseMoveCommand,
    executeMouseDownCommand,
    executeMouseUpCommand,
    executePointerDragCommand,
    executeHoverCommand,
    executeDblClickCommand,
    executeMouseWheelCommand,
    executeDragAndDropCommand,
    executeSetInputFilesCommand,
  };
})();

globalThis.KumaPickerExtensionAgentActionInteraction = KumaPickerExtensionAgentActionInteraction;
})();
