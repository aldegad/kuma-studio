(() => {
  const existingApi = globalThis.KumaPickerExtensionJobCards;
  if (existingApi?.version === 1) {
    return;
  }

  const MAX_VISIBLE_CARDS = 5;
  const FALLBACK_RIGHT = 16;
  const FALLBACK_TOP = 16;
  const CARD_WIDTH = 260;

  let rootElement = null;
  const cards = new Map();
  const dismissedCardIds = new Set();

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

  function statusLabel(status) {
    switch (status) {
      case "in_progress":
        return "작업 중";
      case "completed":
        return "작업 완료";
      default:
        return "메모 남김";
    }
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
      return "방금";
    }

    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) {
      return `${diffMinutes}분 전`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    return `${diffHours}시간 전`;
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
    element.style.fontFamily = '"Pretendard", "SUIT", "IBM Plex Sans KR", "Segoe UI", sans-serif';
    element.style.transition = "transform 140ms ease, opacity 140ms ease";

    const header = document.createElement("div");
    header.setAttribute(UI_ATTRIBUTE, "true");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.marginBottom = "8px";

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
    closeButton.addEventListener("click", () => {
      dismissedCardIds.add(card.id);
      const state = cards.get(card.id);
      if (state?.element) {
        state.element.remove();
      }
    });

    header.append(badge, time, closeButton);

    const title = document.createElement("div");
    title.setAttribute(UI_ATTRIBUTE, "true");
    title.textContent = "내가 고친 곳";
    title.style.fontSize = "13px";
    title.style.fontWeight = "800";
    title.style.lineHeight = "1.35";
    title.style.color = "#22313f";
    title.style.marginBottom = "4px";

    const message = document.createElement("div");
    message.setAttribute(UI_ATTRIBUTE, "true");
    message.dataset.part = "message";
    message.style.fontSize = "12px";
    message.style.lineHeight = "1.55";
    message.style.color = "#5f6e7a";

    const meta = document.createElement("div");
    meta.setAttribute(UI_ATTRIBUTE, "true");
    meta.dataset.part = "meta";
    meta.style.marginTop = "8px";
    meta.style.fontSize = "11px";
    meta.style.fontWeight = "600";
    meta.style.color = "#94a1ac";

    element.append(header, title, message, meta);
    rootElement.appendChild(element);

    return {
      element,
      badge,
      time,
      message,
      meta,
    };
  }

  function updateCardLook(state) {
    const palette = statusColors(state.card.status);
    state.element.style.border = `1px solid ${palette.border}`;
    state.element.style.boxShadow = palette.shadow;
    state.badge.style.background = palette.badgeBg;
    state.badge.style.color = palette.badgeInk;
    state.badge.textContent = statusLabel(state.card.status);
    state.time.textContent = relativeTime(state.card.updatedAt);
    state.message.textContent = state.card.message || "";
    state.meta.textContent = state.card.author ? `by ${state.card.author}` : "";
  }

  function placeCard(state, fallbackIndex = 0) {
    const anchorElement = resolveAnchorElement(state.card.anchor);
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
      .filter((state) => !dismissedCardIds.has(state.card.id))
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
    } else {
      const shell = createCardShell(card);
      cards.set(card.id, {
        ...shell,
        card,
      });
    }

    render();
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

  window.addEventListener("scroll", () => {
    render();
  });
  window.addEventListener("resize", () => {
    render();
  });

  globalThis.KumaPickerExtensionJobCards = {
    version: 1,
    applyJobCardEvent,
  };
})();
