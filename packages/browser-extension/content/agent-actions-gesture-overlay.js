(() => {
var AgentPickerExtensionAgentGestureOverlay = (() => {
  const ROOT_ID = "agent-picker-gesture-overlay-root";
  const PAW_ASSET_PATH = "assets/gestures/kuma-paw-overlay.png";
  const DEFAULT_SIZE = 88;

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

  function getPawAssetUrl() {
    if (typeof chrome?.runtime?.getURL === "function") {
      return chrome.runtime.getURL(PAW_ASSET_PATH);
    }
    return PAW_ASSET_PATH;
  }

  function createPawElement(size) {
    const element = document.createElement("img");
    element.src = getPawAssetUrl();
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
      transformOrigin: "58% 68%",
      filter: "drop-shadow(0 18px 28px rgba(72, 42, 10, 0.16))",
    });
    return element;
  }

  async function playAnimation(element, keyframes, options) {
    const root = getRootElement();
    root.appendChild(element);

    try {
      if (typeof element.animate !== "function") {
        const finalFrame = keyframes[keyframes.length - 1] ?? {};
        Object.assign(element.style, finalFrame);
        await waitForAnimationFrames(1);
        return;
      }

      const animation = element.animate(keyframes, options);
      await animation.finished.catch(() => {});
    } finally {
      element.remove();
    }
  }

  async function playClickGesture(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }

    const size = DEFAULT_SIZE;
    const left = clamp(point.x - size * 0.62, 10, window.innerWidth - size - 10);
    const top = clamp(point.y - size * 0.78, 10, window.innerHeight - size - 10);
    const paw = createPawElement(size);
    paw.style.left = `${left}px`;
    paw.style.top = `${top}px`;

    await playAnimation(
      paw,
      [
        {
          opacity: 0,
          transform: "translate3d(28px, -10px, 0) rotate(-16deg) scale(0.96)",
        },
        {
          opacity: 1,
          transform: "translate3d(0, 0, 0) rotate(-10deg) scale(1)",
          offset: 0.35,
        },
        {
          opacity: 1,
          transform: "translate3d(-4px, 4px, 0) rotate(-7deg) scale(0.9)",
          offset: 0.54,
        },
        {
          opacity: 1,
          transform: "translate3d(0, -1px, 0) rotate(-11deg) scale(1.05)",
          offset: 0.74,
        },
        {
          opacity: 0,
          transform: "translate3d(-10px, 2px, 0) rotate(-14deg) scale(0.98)",
        },
      ],
      {
        duration: 420,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      },
    );
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
    const paw = createPawElement(size);
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
        duration: clamp(240 + Math.abs(deltaY) * 0.28, 280, 560),
        easing: "cubic-bezier(0.2, 0.9, 0.25, 1)",
        fill: "forwards",
      },
    );
  }

  return {
    playClickGesture,
    playScrollGesture,
  };
})();

globalThis.AgentPickerExtensionAgentGestureOverlay = AgentPickerExtensionAgentGestureOverlay;
})();
