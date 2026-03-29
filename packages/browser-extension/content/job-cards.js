(() => {
  const existingApi = globalThis.KumaPickerExtensionJobCards;
  if (existingApi?.version === 1) {
    return;
  }

  const UI_ATTRIBUTE = "data-kuma-picker-extension-ui";
  const MAX_VISIBLE_CARDS = 5;
  const FALLBACK_RIGHT = 16;
  const FALLBACK_TOP = 16;
  const CARD_WIDTH = 260;
  const DISMISSED_STORAGE_KEY = "kuma-picker:dismissed-job-cards";

  let rootElement = null;
  const cards = new Map();
  const dismissedCardIds = new Set();
  let dismissedCardState = loadDismissedCardState();
  let renderScheduled = false;
  let followLayoutFrameId = null;
  let followLayoutUntilMs = 0;

  function loadDismissedCardState() {
    try {
      const raw = globalThis.localStorage?.getItem(DISMISSED_STORAGE_KEY);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([key, value]) => typeof key === "string" && typeof value === "string" && value.trim(),
        ),
      );
    } catch {
      return {};
    }
  }

  function persistDismissedCardState() {
    try {
      globalThis.localStorage?.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(dismissedCardState));
    } catch {
      // Ignore storage quota or disabled storage.
    }
  }

  async function persistCardPosition(card, position) {
    if (!card?.id || !card?.sessionId || !position) {
      return null;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "kuma-picker:update-job-card-position",
        id: card.id,
        sessionId: card.sessionId,
        position: {
          left: position.left,
          top: position.top,
        },
      });

      return response?.ok === false ? null : response ?? null;
    } catch {
      return null;
    }
  }

  async function deleteCardFromDaemon(card) {
    if (!card?.sessionId) {
      return null;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "kuma-picker:dismiss-job-card",
        sessionId: card.sessionId,
      });

      if (response?.ok !== true) {
        throw new Error(response?.error || "Failed to delete the job card.");
      }

      return response?.card ?? null;
    } catch {
      return null;
    }
  }

  function markCardDismissed(card) {
    if (!card?.id) {
      return;
    }

    dismissedCardIds.add(card.id);
    dismissedCardState[card.id] = typeof card.updatedAt === "string" && card.updatedAt.trim() ? card.updatedAt : "dismissed";
    persistDismissedCardState();
  }

  function isCardDismissed(card) {
    if (!card?.id) {
      return false;
    }

    const dismissedAt = dismissedCardState[card.id];
    if (!dismissedAt) {
      return false;
    }

    return dismissedAt === "dismissed" || dismissedAt >= (card.updatedAt || "");
  }

  function ensureRoot() {
    if (rootElement) {
      return;
    }

    rootElement = document.createElement("div");
    rootElement.id = "kuma-picker-job-cards-root";
    rootElement.setAttribute(UI_ATTRIBUTE, "true");
    rootElement.style.position = "fixed";
    rootElement.style.inset = "0";
    rootElement.style.pointerEvents = "none";
    rootElement.style.zIndex = "2147483645";
    document.documentElement.appendChild(rootElement);
  }

  function scheduleRender() {
    if (renderScheduled) {
      return;
    }

    renderScheduled = true;
    globalThis.requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function followLayoutFor(durationMs = 1_500) {
    const nextDeadline = Date.now() + durationMs;
    followLayoutUntilMs = Math.max(followLayoutUntilMs, nextDeadline);

    if (followLayoutFrameId != null) {
      return;
    }

    const tick = () => {
      followLayoutFrameId = null;
      render();

      if (Date.now() < followLayoutUntilMs) {
        followLayoutFrameId = globalThis.requestAnimationFrame(tick);
      }
    };

    followLayoutFrameId = globalThis.requestAnimationFrame(tick);
  }

  function statusLabel(status) {
    switch (status) {
      case "in_progress":
        return "Working";
      case "completed":
        return "Done";
      default:
        return "Queued";
    }
  }

  function secondaryLabel(status) {
    switch (status) {
      case "in_progress":
        return "Progress";
      case "completed":
        return "Updated";
      default:
        return "";
    }
  }

  function displayAuthor(author) {
    if (author === "user") {
      return "You";
    }

    if (author === "codex") {
      return "Agent";
    }

    return author || "Agent";
  }

  function statusColors(status) {
    switch (status) {
      case "in_progress":
        return {
          badgeBg: "#fff0de",
          badgeInk: "#9c6631",
          border: "rgba(230, 165, 69, 0.28)",
          shadow: "0 20px 40px rgba(156, 102, 49, 0.12)",
        };
      case "completed":
        return {
          badgeBg: "#dff5ec",
          badgeInk: "#176852",
          border: "rgba(32, 191, 143, 0.25)",
          shadow: "0 20px 40px rgba(23, 104, 82, 0.12)",
        };
      default:
        return {
          badgeBg: "#eff0ff",
          badgeInk: "#4f58a6",
          border: "rgba(101, 112, 216, 0.2)",
          shadow: "0 20px 40px rgba(79, 88, 166, 0.12)",
        };
    }
  }

  function relativeTime(updatedAt) {
    if (typeof updatedAt !== "string") {
      return "";
    }

    const diffMs = Date.now() - new Date(updatedAt).getTime();
    if (!Number.isFinite(diffMs)) {
      return "";
    }

    const diffSeconds = Math.max(0, Math.round(diffMs / 1000));
    if (diffSeconds < 60) {
      return "Just now";
    }

    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    return `${diffHours}h ago`;
  }

  function normalizeRect(rect) {
    const candidate = rect && typeof rect === "object" ? rect : {};
    return {
      x: typeof candidate.x === "number" ? candidate.x : 0,
      y: typeof candidate.y === "number" ? candidate.y : 0,
      width: typeof candidate.width === "number" ? candidate.width : 0,
      height: typeof candidate.height === "number" ? candidate.height : 0,
    };
  }

  function resolveAnchorElement(anchor) {
    if (!anchor || typeof anchor !== "object") {
      return null;
    }

    if (typeof anchor.selectorPath === "string" && anchor.selectorPath.trim()) {
      try {
        const element = document.querySelector(anchor.selectorPath.trim());
        if (element instanceof Element) {
          return element;
        }
      } catch {
        // Ignore selectorPath parse errors.
      }
    }

    if (typeof anchor.selector === "string" && anchor.selector.trim()) {
      try {
        const element = document.querySelector(anchor.selector.trim());
        if (element instanceof Element) {
          return element;
        }
      } catch {
        // Ignore selector parse errors.
      }
    }

    return null;
  }

  function createCardShell(card) {
    const element = document.createElement("section");
    element.setAttribute(UI_ATTRIBUTE, "true");
    element.dataset.jobCardId = card.id;
    element.style.position = "fixed";
    element.style.width = `${CARD_WIDTH}px`;
    element.style.maxWidth = "calc(100vw - 24px)";
    element.style.padding = "12px 14px";
    element.style.borderRadius = "18px";
    element.style.background = "rgba(255, 255, 255, 0.98)";
    element.style.backdropFilter = "blur(12px)";
    element.style.pointerEvents = "auto";
    element.style.touchAction = "none";
    element.style.fontFamily = '"Pretendard", "SUIT", "IBM Plex Sans KR", "Segoe UI", sans-serif';
    element.style.transition = "transform 140ms ease, opacity 140ms ease";
    element.style.cursor = "grab";

    const header = document.createElement("div");
    header.setAttribute(UI_ATTRIBUTE, "true");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.marginBottom = "8px";
    header.style.cursor = "grab";

    const badge = document.createElement("span");
    badge.setAttribute(UI_ATTRIBUTE, "true");
    badge.dataset.part = "badge";
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.padding = "5px 9px";
    badge.style.borderRadius = "999px";
    badge.style.fontSize = "11px";
    badge.style.fontWeight = "700";
    badge.style.lineHeight = "1";

    const time = document.createElement("span");
    time.setAttribute(UI_ATTRIBUTE, "true");
    time.dataset.part = "time";
    time.style.marginLeft = "auto";
    time.style.fontSize = "11px";
    time.style.color = "#83919d";

    const closeButton = document.createElement("button");
    closeButton.setAttribute(UI_ATTRIBUTE, "true");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.style.width = "24px";
    closeButton.style.height = "24px";
    closeButton.style.border = "1px solid #dbe5ea";
    closeButton.style.borderRadius = "999px";
    closeButton.style.background = "#ffffff";
    closeButton.style.color = "#7d8a96";
    closeButton.style.fontSize = "15px";
    closeButton.style.lineHeight = "1";
    closeButton.style.cursor = "pointer";
    closeButton.addEventListener("click", async () => {
      closeButton.disabled = true;
      closeButton.style.opacity = "0.55";
      const deletedCard = await deleteCardFromDaemon(card);
      if (deletedCard?.id) {
        removeCard(deletedCard.id);
        return;
      }

      closeButton.disabled = false;
      closeButton.style.opacity = "1";
    });

    header.append(badge, time, closeButton);

    const title = document.createElement("div");
    title.setAttribute(UI_ATTRIBUTE, "true");
    const requestMessage = document.createElement("div");
    requestMessage.setAttribute(UI_ATTRIBUTE, "true");
    requestMessage.dataset.part = "request-message";
    requestMessage.style.fontSize = "12px";
    requestMessage.style.lineHeight = "1.55";
    requestMessage.style.color = "#33424f";
    requestMessage.style.marginTop = "2px";

    const resultBlock = document.createElement("div");
    resultBlock.setAttribute(UI_ATTRIBUTE, "true");
    resultBlock.style.display = "grid";
    resultBlock.style.gap = "4px";
    resultBlock.style.marginTop = "8px";

    const resultLabel = document.createElement("div");
    resultLabel.setAttribute(UI_ATTRIBUTE, "true");
    resultLabel.dataset.part = "result-label";
    resultLabel.style.fontSize = "11px";
    resultLabel.style.fontWeight = "800";
    resultLabel.style.lineHeight = "1.35";
    resultLabel.style.color = "#60707d";

    const resultMessage = document.createElement("div");
    resultMessage.setAttribute(UI_ATTRIBUTE, "true");
    resultMessage.dataset.part = "result-message";
    resultMessage.style.fontSize = "12px";
    resultMessage.style.lineHeight = "1.55";
    resultMessage.style.color = "#5f6e7a";

    resultBlock.append(resultLabel, resultMessage);

    const meta = document.createElement("div");
    meta.setAttribute(UI_ATTRIBUTE, "true");
    meta.dataset.part = "meta";
    meta.style.marginTop = "8px";
    meta.style.fontSize = "11px";
    meta.style.fontWeight = "600";
    meta.style.color = "#94a1ac";

    element.append(header, requestMessage, resultBlock, meta);
    rootElement.appendChild(element);

    const state = {
      element,
      header,
      badge,
      time,
      requestMessage,
      resultBlock,
      resultLabel,
      resultMessage,
      meta,
      dragPosition: null,
    };

    attachDragHandlers(state, closeButton);
    return state;
  }

  function updateCardLook(state) {
    const palette = statusColors(state.card.status);
    state.element.style.border = `1px solid ${palette.border}`;
    state.element.style.boxShadow = palette.shadow;
    state.badge.style.background = palette.badgeBg;
    state.badge.style.color = palette.badgeInk;
    state.badge.textContent = statusLabel(state.card.status);
    state.time.textContent = relativeTime(state.card.updatedAt);
    state.requestMessage.textContent = state.card.requestMessage || state.card.message || "";
    const nextResultMessage = state.card.resultMessage || "";
    state.resultLabel.textContent = secondaryLabel(state.card.status);
    state.resultMessage.textContent = nextResultMessage;
    state.resultBlock.style.display = nextResultMessage ? "grid" : "none";
    state.meta.textContent = state.card.author ? `Updated by ${displayAuthor(state.card.author)}` : "";
  }

  function clampManualPosition(left, top, element) {
    return {
      left: Math.max(12, Math.min(left, window.innerWidth - element.offsetWidth - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - element.offsetHeight - 12)),
    };
  }

  function attachDragHandlers(state, closeButton) {
    let dragState = null;

    const endDrag = () => {
      if (!dragState) {
        return;
      }

      state.element.style.cursor = "grab";
      state.header.style.cursor = "grab";
      const persistedPosition = state.dragPosition
        ? {
            left: state.dragPosition.left,
            top: state.dragPosition.top,
          }
        : null;
      if (persistedPosition) {
        state.card = {
          ...state.card,
          position: persistedPosition,
        };
        state.dragPosition = null;
        void persistCardPosition(state.card, persistedPosition).then((nextCard) => {
          if (nextCard?.id === state.card?.id) {
            upsertCard(nextCard);
          }
        });
      }
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", endDrag, true);
      window.removeEventListener("pointercancel", endDrag, true);
      dragState = null;
    };

    const handlePointerMove = (event) => {
      if (!dragState) {
        return;
      }

      const nextLeft = dragState.startLeft + (event.clientX - dragState.startX);
      const nextTop = dragState.startTop + (event.clientY - dragState.startY);
      state.dragPosition = clampManualPosition(nextLeft, nextTop, state.element);
      state.element.style.left = `${state.dragPosition.left}px`;
      state.element.style.top = `${state.dragPosition.top}px`;
      event.preventDefault();
    };

    state.element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      if (event.target instanceof Element && event.target.closest("button") === closeButton) {
        return;
      }

      const rect = state.element.getBoundingClientRect();
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      };
      state.element.style.cursor = "grabbing";
      state.header.style.cursor = "grabbing";
      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", endDrag, true);
      window.addEventListener("pointercancel", endDrag, true);
      event.preventDefault();
    });
  }

  function placeCard(state, fallbackIndex = 0) {
    const explicitPosition =
      state.dragPosition ??
      (state.card?.position &&
      typeof state.card.position === "object" &&
      typeof state.card.position.left === "number" &&
      Number.isFinite(state.card.position.left) &&
      typeof state.card.position.top === "number" &&
      Number.isFinite(state.card.position.top)
        ? state.card.position
        : null);

    if (explicitPosition) {
      const clamped = clampManualPosition(explicitPosition.left, explicitPosition.top, state.element);
      state.element.style.left = `${clamped.left}px`;
      state.element.style.top = `${clamped.top}px`;
      return;
    }

    const anchorElement = resolveAnchorElement(state.card.anchor);
    const rawAnchorPoint =
      state.card.anchor?.point &&
      typeof state.card.anchor.point.x === "number" &&
      typeof state.card.anchor.point.y === "number"
        ? state.card.anchor.point
        : null;
    const anchorPoint =
      rawAnchorPoint && anchorElement instanceof Element && state.card.anchor?.rect
        ? {
            x: anchorElement.getBoundingClientRect().x + (rawAnchorPoint.x - state.card.anchor.rect.x),
            y: anchorElement.getBoundingClientRect().y + (rawAnchorPoint.y - state.card.anchor.rect.y),
          }
        : rawAnchorPoint;

    if (anchorPoint) {
      const left = Math.max(12, Math.min(anchorPoint.x + 12, window.innerWidth - CARD_WIDTH - 12));
      const top = Math.max(12, Math.min(anchorPoint.y + 12, window.innerHeight - state.element.offsetHeight - 12));
      state.element.style.left = `${left}px`;
      state.element.style.top = `${top}px`;
      return;
    }

    const anchorRect =
      anchorElement instanceof Element
        ? anchorElement.getBoundingClientRect()
        : state.card.anchor?.rect
          ? normalizeRect(state.card.anchor.rect)
          : null;

    if (anchorRect) {
      const left = Math.max(12, Math.min(anchorRect.x, window.innerWidth - CARD_WIDTH - 12));
      const top = Math.max(
        12,
        Math.min(anchorRect.y + anchorRect.height + 10, window.innerHeight - state.element.offsetHeight - 12),
      );
      state.element.style.left = `${left}px`;
      state.element.style.top = `${top}px`;
      return;
    }

    state.element.style.left = `${Math.max(12, window.innerWidth - CARD_WIDTH - FALLBACK_RIGHT)}px`;
    state.element.style.top = `${FALLBACK_TOP + fallbackIndex * 112}px`;
  }

  function render() {
    ensureRoot();

    const visibleCards = [...cards.values()]
      .filter((state) => !dismissedCardIds.has(state.card.id) && !isCardDismissed(state.card))
      .sort((left, right) => left.card.updatedAt.localeCompare(right.card.updatedAt))
      .slice(-MAX_VISIBLE_CARDS);

    const visibleSet = new Set(visibleCards.map((state) => state.card.id));
    for (const [cardId, state] of cards.entries()) {
      state.element.style.display = visibleSet.has(cardId) ? "block" : "none";
    }

    visibleCards.forEach((state, index) => {
      updateCardLook(state);
      placeCard(state, index);
    });
  }

  function upsertCard(card) {
    if (!card?.id) {
      return;
    }

    ensureRoot();
    const existing = cards.get(card.id);
    if (existing) {
      existing.card = {
        ...existing.card,
        ...card,
      };
      if (!isCardDismissed(existing.card)) {
        dismissedCardIds.delete(card.id);
      }
    } else {
      const shell = createCardShell(card);
      cards.set(card.id, {
        ...shell,
        card,
      });
      if (isCardDismissed(card)) {
        dismissedCardIds.add(card.id);
      }
    }

    render();
    followLayoutFor();
  }

  function removeCard(cardId) {
    const state = cards.get(cardId);
    if (!state) {
      return;
    }

    state.element.remove();
    cards.delete(cardId);
    render();
  }

  function applyJobCardEvent(message) {
    if (message?.deleted) {
      removeCard(message?.card?.id ?? message?.id);
      return;
    }

    if (message?.card) {
      upsertCard(message.card);
    }
  }

  document.addEventListener("scroll", scheduleRender, true);
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("load", () => {
    followLayoutFor();
  });
  window.addEventListener("pageshow", () => {
    followLayoutFor();
  });

  globalThis.KumaPickerExtensionJobCards = {
    version: 1,
    applyJobCardEvent,
  };
})();
