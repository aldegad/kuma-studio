(() => {
  var KumaPickerExtensionAgentGestureOverlay = (() => {
    const ROOT_ID = "kuma-picker-gesture-overlay-root";
    const CLICK_ASSET_PATH = "assets/gestures/kuma-paw-tap.png";
    const DEFAULT_SIZE = 88;
    const CLICK_SIZE = 70;
    const CLICK_HOTSPOT_Y = 0.25;
    const HOLD_HOTSPOT_Y = 0.5;
    let recordingGestureDurationMultiplier = 1;
    const activeHoldGestures = new Map();

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function waitForAnimationFrame() {
      return new Promise((resolvePromise) => {
        window.requestAnimationFrame(() => resolvePromise());
      });
    }

    async function waitForAnimationFrames(count) {
      for (let index = 0; index < count; index += 1) {
        await waitForAnimationFrame();
      }
    }

    function getRootElement() {
      let root = document.getElementById(ROOT_ID);
      if (root) {
        return root;
      }

      root = document.createElement("div");
      root.id = ROOT_ID;
      root.setAttribute("aria-hidden", "true");
      Object.assign(root.style, {
        position: "fixed",
        inset: "0",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: "2147483647",
        userSelect: "none",
        contain: "layout style paint",
      });

      const mountTarget = document.documentElement || document.body;
      mountTarget?.appendChild(root);
      return root;
    }

    function getPawAssetUrl(kind) {
      const assetPath = CLICK_ASSET_PATH;
      if (typeof chrome?.runtime?.getURL === "function") {
        return chrome.runtime.getURL(assetPath);
      }
      return assetPath;
    }

    function createPawElement(size, kind = "click") {
      const element = document.createElement("img");
      element.src = getPawAssetUrl(kind);
      element.alt = "";
      element.draggable = false;
      Object.assign(element.style, {
        position: "fixed",
        width: `${size}px`,
        height: `${size}px`,
        maxWidth: "none",
        pointerEvents: "none",
        opacity: "0",
        willChange: "transform, opacity",
        transformOrigin: "50% 86%",
        filter: "drop-shadow(0 18px 28px rgba(72, 42, 10, 0.16))",
      });
      return element;
    }

    function getClickPlacement(point, size = CLICK_SIZE) {
      return {
        left: clamp(point.x - size * 0.5, 10, window.innerWidth - size - 10),
        top: clamp(point.y - size * CLICK_HOTSPOT_Y, 10, window.innerHeight - size - 10),
      };
    }

    function getHoldPlacement(point, size = CLICK_SIZE) {
      return {
        left: clamp(point.x - size * 0.5, 10, window.innerWidth - size - 10),
        top: clamp(point.y - size * HOLD_HOTSPOT_Y, 10, window.innerHeight - size - 10),
      };
    }

    function applyElementFrame(element, frame) {
      for (const [key, value] of Object.entries(frame)) {
        if (value != null) {
          element.style[key] = value;
        }
      }
    }

    async function playAnimation(element, keyframes, options) {
      const root = getRootElement();
      root.appendChild(element);

      try {
        if (document.visibilityState !== "visible") {
          const finalFrame = keyframes[keyframes.length - 1] ?? {};
          Object.assign(element.style, finalFrame);
          return;
        }

        if (typeof element.animate !== "function") {
          const finalFrame = keyframes[keyframes.length - 1] ?? {};
          Object.assign(element.style, finalFrame);
          await waitForAnimationFrames(1);
          return;
        }

        const animation = element.animate(keyframes, options);
        await animation.finished.catch(() => { });
      } finally {
        element.remove();
      }
    }

    async function playClickGesture(point) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return;
      }

      const size = CLICK_SIZE;
      const { left, top } = getClickPlacement(point, size);
      const paw = createPawElement(size, "click");
      paw.style.left = `${left}px`;
      paw.style.top = `${top}px`;

      await playAnimation(
        paw,
        [
          {
            opacity: 0,
            transform: "translate3d(0, 5px, 0) scale(1)",
          },
          {
            opacity: 1,
            offset: 0.1,
          },
          {
            opacity: 1,
            transform: "translate3d(0, 2px, 0) scale(1)",
            offset: 0.5,
          },
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(0.9)",
            offset: 0.65,
          },
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(1)",
            offset: 0.8,
          },
          {
            opacity: 1,
            offset: 0.9,
          },
          {
            opacity: 0,
            transform: "translate3d(0, 5px, 0) scale(1)",
          },
        ],
        {
          duration: Math.round(380 * recordingGestureDurationMultiplier),
          easing: "ease-in-out",
          fill: "forwards",
        },
      );
    }

    async function holdClickGesture(point, holdId = "default") {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return;
      }

      const root = getRootElement();
      const size = CLICK_SIZE;
      const { left, top } = getHoldPlacement(point, size);

      const existingHold = activeHoldGestures.get(holdId);
      if (existingHold?.element instanceof Element) {
        existingHold.element.remove();
        activeHoldGestures.delete(holdId);
      }

      const paw = createPawElement(size, "click");
      paw.style.left = `${left}px`;
      paw.style.top = `${top}px`;
      root.appendChild(paw);

      const finalFrame = {
        opacity: "1",
        transform: "translate3d(0, 0, 0) scale(0.9)",
      };

      activeHoldGestures.set(holdId, {
        element: paw,
        size,
      });

      if (document.visibilityState !== "visible" || typeof paw.animate !== "function") {
        applyElementFrame(paw, finalFrame);
        await waitForAnimationFrames(1);
        return;
      }

      const animation = paw.animate(
        [
          {
            opacity: 0,
            transform: "translate3d(0, 5px, 0) scale(1)",
          },
          {
            opacity: 1,
            offset: 0.1,
          },
          {
            opacity: 1,
            transform: "translate3d(0, 2px, 0) scale(1)",
            offset: 0.5,
          },
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(0.9)",
          },
        ],
        {
          duration: Math.round(240 * recordingGestureDurationMultiplier),
          easing: "ease-in-out",
          fill: "forwards",
        },
      );
      await animation.finished.catch(() => { });
      if (activeHoldGestures.get(holdId)?.element === paw) {
        applyElementFrame(paw, finalFrame);
      }
    }

    function moveHeldGesture(point, holdId = "default") {
      const hold = activeHoldGestures.get(holdId);
      if (
        !(hold?.element instanceof Element) ||
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      ) {
        return;
      }

      const { left, top } = getHoldPlacement(point, hold.size ?? CLICK_SIZE);
      hold.element.style.left = `${left}px`;
      hold.element.style.top = `${top}px`;
    }

    async function releaseHeldGesture(point, holdId = "default") {
      const hold = activeHoldGestures.get(holdId);
      if (!(hold?.element instanceof Element)) {
        return;
      }

      const { element, size } = hold;
      activeHoldGestures.delete(holdId);

      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        const { left, top } = getHoldPlacement(point, size ?? CLICK_SIZE);
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
      }

      if (document.visibilityState !== "visible" || typeof element.animate !== "function") {
        element.remove();
        await waitForAnimationFrames(1);
        return;
      }

      const animation = element.animate(
        [
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(0.9)",
          },
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(1)",
            offset: 0.4,
          },
          {
            opacity: 0,
            transform: "translate3d(0, 5px, 0) scale(1)",
          },
        ],
        {
          duration: Math.round(180 * recordingGestureDurationMultiplier),
          easing: "ease-in-out",
          fill: "forwards",
        },
      );
      await animation.finished.catch(() => { });
      element.remove();
    }

    function clearHeldGesture(holdId) {
      if (holdId == null) {
        for (const hold of activeHoldGestures.values()) {
          hold.element?.remove?.();
        }
        activeHoldGestures.clear();
        return;
      }

      const hold = activeHoldGestures.get(holdId);
      if (!(hold?.element instanceof Element)) {
        return;
      }
      hold.element.remove();
      activeHoldGestures.delete(holdId);
    }

    async function playScrollGesture(details) {
      const deltaY = Number(details?.deltaY);
      if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 18) {
        return;
      }

      const size = clamp(DEFAULT_SIZE + Math.abs(deltaY) * 0.03, 84, 116);
      const travel = clamp(Math.abs(deltaY) * 0.2, 42, 156);
      const movesUp = deltaY < 0;
      const left = clamp(window.innerWidth - size - 26, 10, window.innerWidth - size - 10);
      const startY = movesUp
        ? clamp(window.innerHeight - size - 42, 14, window.innerHeight - size - 14)
        : 24;
      const endY = startY + (movesUp ? -travel : travel);
      const paw = createPawElement(size, "grab");
      paw.style.left = `${left}px`;
      paw.style.top = `${startY}px`;

      await playAnimation(
        paw,
        [
          {
            opacity: 0,
            transform: `translate3d(0, ${movesUp ? 16 : -16}px, 0) rotate(${movesUp ? "-8deg" : "8deg"}) scale(0.96)`,
          },
          {
            opacity: 0.95,
            transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)",
            offset: 0.18,
          },
          {
            opacity: 1,
            transform: `translate3d(0, ${endY - startY}px, 0) rotate(${movesUp ? "-10deg" : "10deg"}) scale(0.93)`,
            offset: 0.78,
          },
          {
            opacity: 0,
            transform: `translate3d(0, ${endY - startY}px, 0) rotate(${movesUp ? "-12deg" : "12deg"}) scale(1.02)`,
          },
        ],
        {
          duration: Math.round(clamp(240 + Math.abs(deltaY) * 0.28, 280, 560) * recordingGestureDurationMultiplier),
          easing: "cubic-bezier(0.2, 0.9, 0.25, 1)",
          fill: "forwards",
        },
      );
    }

    async function playDragGesture(details) {
      const from = details?.from;
      const to = details?.to;
      if (
        !from || !to ||
        !Number.isFinite(from.x) || !Number.isFinite(from.y) ||
        !Number.isFinite(to.x) || !Number.isFinite(to.y)
      ) {
        return;
      }

      const durationMs = Math.max(200, Math.min(10_000, Number(details?.durationMs) || 500));
      const size = DEFAULT_SIZE;
      const paw = createPawElement(size, "grab");
      const startLeft = clamp(from.x - size * 0.58, 10, window.innerWidth - size - 10);
      const startTop = clamp(from.y - size * 0.68, 10, window.innerHeight - size - 10);
      paw.style.left = `${startLeft}px`;
      paw.style.top = `${startTop}px`;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const animDuration = Math.min(durationMs, 1200);

      await playAnimation(
        paw,
        [
          {
            opacity: 0,
            transform: "translate3d(0, 0, 0) scale(0.9)",
          },
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(1)",
            offset: 0.1,
          },
          {
            opacity: 1,
            transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.95)`,
            offset: 0.85,
          },
          {
            opacity: 0,
            transform: `translate3d(${dx}px, ${dy}px, 0) scale(1)`,
          },
        ],
        {
          duration: Math.round(animDuration * recordingGestureDurationMultiplier),
          easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
          fill: "forwards",
        },
      );
    }

    function setRecordingMode(active) {
      recordingGestureDurationMultiplier = active === true ? 3 : 1;
    }

    return {
      playClickGesture,
      holdClickGesture,
      moveHeldGesture,
      releaseHeldGesture,
      clearHeldGesture,
      playScrollGesture,
      playDragGesture,
      setRecordingMode,
    };
  })();

  globalThis.KumaPickerExtensionAgentGestureOverlay = KumaPickerExtensionAgentGestureOverlay;
})();
