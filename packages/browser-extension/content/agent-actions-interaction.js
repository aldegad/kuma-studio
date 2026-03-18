const {
  FOCUSABLE_SELECTOR,
  normalizeText,
  normalizeRole,
  isExtensionUiElement,
  describeElementForCommand,
  isVisibleElement,
  isTextInputElement,
  isFillableElement,
  resolveCommandTarget,
  resolveFillTarget,
} = globalThis.AgentPickerExtensionAgentActionCore;

const AgentPickerExtensionAgentActionInteraction = (() => {
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
    target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
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

  function readClickOutcome(target) {
    return {
      page: buildPageRecord(),
      ariaSelected: target.getAttribute?.("aria-selected") ?? null,
      dataState: target.getAttribute?.("data-state") ?? null,
      open: target.hasAttribute?.("open") ?? false,
    };
  }

  function shouldUseSemanticClickFallback(target, before, after) {
    const isTabLike =
      normalizeRole(target.getAttribute?.("role")) === "tab" || Boolean(target.getAttribute?.("aria-controls"));
    if (!isTabLike) {
      return false;
    }

    return (
      before.page?.url === after.page?.url &&
      before.page?.pathname === after.page?.pathname &&
      before.ariaSelected === after.ariaSelected &&
      before.dataState === after.dataState &&
      before.open === after.open
    );
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

  function dispatchInputEvents(target, value) {
    const inputEvent =
      typeof InputEvent === "function"
        ? new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: value,
          })
        : new Event("input", { bubbles: true, composed: true });

    target.dispatchEvent(inputEvent);
    target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
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
      currentIndex < 0 ? 0 : (currentIndex + (shiftKey ? -1 : 1) + focusable.length) % focusable.length;
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
    const before = readClickOutcome(target);
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let fallbackUsed = false;

    if (target instanceof HTMLElement) {
      target.click();
    } else {
      dispatchClickSequence(target, centerX, centerY);
    }

    await waitForDelay(Math.min(150, Math.max(50, Math.round((command?.postActionDelayMs ?? 400) / 2))));

    if (shouldUseSemanticClickFallback(target, before, readClickOutcome(target))) {
      dispatchClickSequence(target, centerX, centerY);
      fallbackUsed = true;
    }

    await waitForPostActionDelay(command, 400);
    return {
      page: buildPageRecord(),
      clickedElement: describeElementForCommand(target),
      fallbackUsed,
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

  return {
    waitForDelay,
    executeClickCommand,
    executeClickPointCommand,
    executeFillCommand,
    executeKeyCommand,
  };
})();

globalThis.AgentPickerExtensionAgentActionInteraction = AgentPickerExtensionAgentActionInteraction;
