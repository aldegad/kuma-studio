(() => {
var {
  FOCUSABLE_SELECTOR: coreFocusableSelector,
  normalizeText: coreNormalizeText,
  normalizeRole: coreNormalizeRole,
  isExtensionUiElement: coreIsExtensionUiElement,
  describeElementForCommand: coreDescribeElementForCommand,
  isVisibleElement: coreIsVisibleElement,
  isTextInputElement: coreIsTextInputElement,
  isFillableElement: coreIsFillableElement,
  resolveCommandTarget: coreResolveCommandTarget,
  resolveFillTarget: coreResolveFillTarget,
} = globalThis.KumaPickerExtensionAgentActionCore;
var gestureOverlay = globalThis.KumaPickerExtensionAgentGestureOverlay ?? null;

var KumaPickerExtensionAgentActionInteraction = (() => {
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
    for (let index = 0; index < count; index += 1) {
      await new Promise((resolvePromise) => {
        window.requestAnimationFrame(() => resolvePromise());
      });
    }
  }

  async function focusElement(target) {
    const beforeRect = target.getBoundingClientRect();
    const shouldWatchScroll = !isRectMostlyVisible(beforeRect);
    target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    target.focus?.({ preventScroll: true });

    if (!shouldWatchScroll) {
      return;
    }

    await waitForAnimationFrames(2);

    const afterRect = target.getBoundingClientRect();
    const deltaY = afterRect.top - beforeRect.top;
    if (Math.abs(deltaY) >= 18) {
      await gestureOverlay?.playScrollGesture?.({
        deltaY,
        center: readElementCenter(afterRect),
      });
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
      coreNormalizeRole(target.getAttribute?.("role")) === "tab" || Boolean(target.getAttribute?.("aria-controls"));
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

  function dispatchKeyboardEvent(target, type, key, shiftKey, code) {
    return target.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
        composed: true,
        shiftKey,
      }),
    );
  }

  async function executeClickCommand(command) {
    const target = coreResolveCommandTarget(command);
    if (!(target instanceof Element)) {
      throw new Error("Failed to find a matching element to click in the active tab.");
    }

    await focusElement(target);
    const before = readClickOutcome(target);
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let fallbackUsed = false;

    await gestureOverlay?.playClickGesture?.({ x: centerX, y: centerY });

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
      clickedElement: coreDescribeElementForCommand(target),
      fallbackUsed,
    };
  }

  async function executeClickPointCommand(command) {
    const { x, y, target } = getPointTarget(command);
    await focusElement(target);
    await gestureOverlay?.playClickGesture?.({ x, y });
    dispatchClickSequence(target, x, y);
    await waitForPostActionDelay(command, 400);

    return {
      page: buildPageRecord(),
      clickPoint: { x, y },
      clickedElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeFillCommand(command) {
    const target = coreResolveFillTarget(command);
    if (!(target instanceof Element) || !coreIsFillableElement(target)) {
      throw new Error("Failed to find a fillable input, textarea, select, or contenteditable target.");
    }

    const value = typeof command?.value === "string" ? command.value : "";
    await focusElement(target);

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
      target.textContent = value;
      dispatchInputEvents(target, value);
    }

    await waitForPostActionDelay(command, 100);
    return {
      page: buildPageRecord(),
      filledElement: coreDescribeElementForCommand(target),
      label: typeof command?.label === "string" ? coreNormalizeText(command.label) || null : null,
      value,
    };
  }

  async function executeKeyCommand(command) {
    const normalizedKey = normalizeKeyboardCommandKey(command?.key);
    if (!normalizedKey?.key) {
      throw new Error("The key command requires a non-empty key.");
    }

    const key = normalizedKey.key;
    const code = normalizedKey.code;
    const shiftKey = command?.shiftKey === true;
    const holdMs =
      typeof command?.holdMs === "number" && Number.isFinite(command.holdMs)
        ? Math.max(0, Math.min(10_000, Math.round(command.holdMs)))
        : 0;
    const target =
      coreResolveCommandTarget(command, { allowFocusedElement: true }) ??
      (document.body instanceof Element ? document.body : document.documentElement);

    if (!(target instanceof Element)) {
      throw new Error("Failed to find a target element for the keyboard command.");
    }

    target.focus?.({ preventScroll: true });
    dispatchKeyboardEvent(target, "keydown", key, shiftKey, code);
    dispatchKeyboardEvent(target, "keypress", key, shiftKey, code);

    let keyResult = null;
    if (key === "Tab") {
      const nextTarget = moveFocus(shiftKey);
      keyResult = nextTarget ? { focusedElement: coreDescribeElementForCommand(nextTarget) } : null;
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

    if (holdMs > 0) {
      await waitForDelay(holdMs);
    }

    dispatchKeyboardEvent(target, "keyup", key, shiftKey, code);
    await waitForPostActionDelay(command, 100);

    return {
      page: buildPageRecord(),
      key,
      code,
      shiftKey,
      holdMs,
      targetElement: coreDescribeElementForCommand(target),
      ...keyResult,
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

    await gestureOverlay?.playDragGesture?.({ from: start, to: end, durationMs });

    dispatchPointerEvent(target, "pointerdown", start.x, start.y, { button: 0, buttons: 1 });
    dispatchMouseEvent(target, "mousedown", start.x, start.y);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = interpolateWaypoints(waypoints, t);
      dispatchPointerEvent(target, "pointermove", point.x, point.y, { button: 0, buttons: 1 });
      dispatchMouseEvent(target, "mousemove", point.x, point.y);
      if (stepDelay > 0) {
        await waitForDelay(stepDelay);
      }
    }

    dispatchPointerEvent(target, "pointerup", end.x, end.y, { button: 0, buttons: 0 });
    dispatchMouseEvent(target, "mouseup", end.x, end.y);

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

  return {
    waitForDelay,
    executeClickCommand,
    executeClickPointCommand,
    executeFillCommand,
    executeKeyCommand,
    executePointerDragCommand,
  };
})();

globalThis.KumaPickerExtensionAgentActionInteraction = KumaPickerExtensionAgentActionInteraction;
})();
