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
  let activePointerState = {
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
    const navigationLikely = isLikelyNavigationClickTarget(target);

    await gestureOverlay?.playClickGesture?.({ x: centerX, y: centerY });

    if (target instanceof HTMLElement) {
      target.click();
    } else {
      dispatchClickSequence(target, centerX, centerY);
    }

    if (navigationLikely) {
      return {
        page: buildPageRecord(),
        clickedElement: coreDescribeElementForCommand(target),
        fallbackUsed,
        navigationLikely,
      };
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
      navigationLikely,
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

  async function executeKeyDownCommand(command) {
    const normalizedKey = normalizeKeyboardCommandKey(command?.key);
    if (!normalizedKey?.key) {
      throw new Error("The keydown command requires a non-empty key.");
    }

    const target =
      coreResolveCommandTarget(command, { allowFocusedElement: true }) ??
      (document.activeElement instanceof Element
        ? document.activeElement
        : document.body instanceof Element
          ? document.body
          : document.documentElement);

    if (!(target instanceof Element)) {
      throw new Error("Failed to find a target element for the keydown command.");
    }

    target.focus?.({ preventScroll: true });
    dispatchKeyboardEvent(target, "keydown", normalizedKey.key, command?.shiftKey === true, normalizedKey.code);
    pressedKeys.set(normalizedKey.code, {
      key: normalizedKey.key,
      code: normalizedKey.code,
      shiftKey: command?.shiftKey === true,
      target,
    });
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      key: normalizedKey.key,
      code: normalizedKey.code,
      shiftKey: command?.shiftKey === true,
      targetElement: coreDescribeElementForCommand(target),
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
      coreResolveCommandTarget(command, { allowFocusedElement: true }) ??
      (document.activeElement instanceof Element
        ? document.activeElement
        : document.body instanceof Element
          ? document.body
          : document.documentElement);

    if (!(target instanceof Element)) {
      throw new Error("Failed to find a target element for the keyup command.");
    }

    dispatchKeyboardEvent(
      target,
      "keyup",
      stored?.key ?? normalizedKey.key,
      stored?.shiftKey ?? (command?.shiftKey === true),
      stored?.code ?? normalizedKey.code,
    );
    pressedKeys.delete(normalizedKey.code);
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      key: stored?.key ?? normalizedKey.key,
      code: stored?.code ?? normalizedKey.code,
      shiftKey: stored?.shiftKey ?? (command?.shiftKey === true),
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
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      point,
      buttons: activePointerState.buttons ?? 0,
      targetElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeMouseDownCommand(command) {
    const point = readViewportPoint(command, "mousedown");
    const buttonInfo = resolveMouseButton(command?.button);
    const target = getInteractivePointTarget(point, "mousedown");

    target.focus?.({ preventScroll: true });

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

    activePointerState = {
      button: buttonInfo.button,
      buttons: buttonInfo.buttons,
      target,
      lastPoint: point,
      downTarget: target,
      downPoint: point,
      moved: false,
    };
    await waitForPostActionDelay(command, 0);

    return {
      page: buildPageRecord(),
      point,
      button: buttonInfo.name,
      targetElement: coreDescribeElementForCommand(target),
    };
  }

  async function executeMouseUpCommand(command) {
    const point = readViewportPoint(command, "mouseup");
    const fallbackButtonInfo = resolveMouseButton(command?.button);
    const releaseTarget = getInteractivePointTarget(point, "mouseup");
    const target =
      activePointerState.target instanceof Element && document.contains(activePointerState.target)
        ? activePointerState.target
        : releaseTarget;
    const button =
      typeof activePointerState.button === "number"
        ? activePointerState.button
        : fallbackButtonInfo.button;
    const buttonName =
      activePointerState.buttons > 0
        ? button === 2
          ? "right"
          : button === 1
            ? "middle"
            : "left"
        : fallbackButtonInfo.name;

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

    const synthesizedClick =
      button === 0 &&
      !activePointerState.moved &&
      shouldSynthesizeClick(activePointerState.downTarget, releaseTarget);
    if (synthesizedClick) {
      dispatchMouseEvent(target, "click", point.x, point.y, {
        button,
        buttons: 0,
        detail: 1,
      });
    }

    activePointerState = {
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

  return {
    waitForDelay,
    executeClickCommand,
    executeClickPointCommand,
    executeFillCommand,
    executeKeyCommand,
    executeKeyDownCommand,
    executeKeyUpCommand,
    executeMouseMoveCommand,
    executeMouseDownCommand,
    executeMouseUpCommand,
    executePointerDragCommand,
  };
})();

globalThis.KumaPickerExtensionAgentActionInteraction = KumaPickerExtensionAgentActionInteraction;
})();
