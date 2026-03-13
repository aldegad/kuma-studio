(function () {
  const UI_ATTRIBUTE = "data-agent-picker-extension-ui";
  const ROOT_ID = "agent-picker-extension-root";

  let isInspecting = false;
  let hoveredElement = null;
  let rootElement = null;
  let outlineElement = null;
  let labelElement = null;
  let toastElement = null;
  let toastTimerId = null;

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function isUiElement(element) {
    return Boolean(
      element && element.closest && element.closest(`[${UI_ATTRIBUTE}="true"]`),
    );
  }

  function getTargetElement(input) {
    if (!input) return null;
    if (input instanceof Element) {
      return input;
    }
    if (input instanceof Node) {
      return input.parentElement;
    }
    return null;
  }

  function ensureUi() {
    if (rootElement) {
      return;
    }

    rootElement = document.createElement("div");
    rootElement.id = ROOT_ID;
    rootElement.setAttribute(UI_ATTRIBUTE, "true");
    rootElement.style.position = "fixed";
    rootElement.style.inset = "0";
    rootElement.style.pointerEvents = "none";
    rootElement.style.zIndex = "2147483646";

    outlineElement = document.createElement("div");
    outlineElement.setAttribute(UI_ATTRIBUTE, "true");
    outlineElement.style.position = "fixed";
    outlineElement.style.border = "2px solid #25c69c";
    outlineElement.style.background = "rgba(37, 198, 156, 0.12)";
    outlineElement.style.boxShadow = "0 0 0 1px rgba(37, 198, 156, 0.18)";
    outlineElement.style.pointerEvents = "none";
    outlineElement.style.display = "none";

    labelElement = document.createElement("div");
    labelElement.setAttribute(UI_ATTRIBUTE, "true");
    labelElement.style.position = "fixed";
    labelElement.style.maxWidth = "280px";
    labelElement.style.padding = "6px 8px";
    labelElement.style.borderRadius = "10px";
    labelElement.style.background = "#17242b";
    labelElement.style.color = "#ffffff";
    labelElement.style.fontFamily = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    labelElement.style.fontSize = "11px";
    labelElement.style.fontWeight = "700";
    labelElement.style.lineHeight = "1.35";
    labelElement.style.boxShadow = "0 14px 28px rgba(15, 23, 42, 0.24)";
    labelElement.style.pointerEvents = "none";
    labelElement.style.display = "none";

    toastElement = document.createElement("div");
    toastElement.setAttribute(UI_ATTRIBUTE, "true");
    toastElement.style.position = "fixed";
    toastElement.style.right = "16px";
    toastElement.style.bottom = "16px";
    toastElement.style.maxWidth = "320px";
    toastElement.style.padding = "10px 14px";
    toastElement.style.borderRadius = "14px";
    toastElement.style.background = "rgba(23, 36, 43, 0.94)";
    toastElement.style.color = "#ffffff";
    toastElement.style.fontFamily = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    toastElement.style.fontSize = "12px";
    toastElement.style.lineHeight = "1.5";
    toastElement.style.boxShadow = "0 18px 36px rgba(15, 23, 42, 0.26)";
    toastElement.style.opacity = "0";
    toastElement.style.transform = "translateY(6px)";
    toastElement.style.transition = "opacity 120ms ease, transform 120ms ease";

    rootElement.appendChild(outlineElement);
    rootElement.appendChild(labelElement);
    rootElement.appendChild(toastElement);
    document.documentElement.appendChild(rootElement);
  }

  function setToast(message, tone) {
    ensureUi();

    if (toastTimerId) {
      clearTimeout(toastTimerId);
      toastTimerId = null;
    }

    toastElement.textContent = message;
    toastElement.style.background =
      tone === "error" ? "rgba(143, 47, 47, 0.96)" : "rgba(23, 36, 43, 0.94)";
    toastElement.style.opacity = "1";
    toastElement.style.transform = "translateY(0)";

    toastTimerId = window.setTimeout(() => {
      toastElement.style.opacity = "0";
      toastElement.style.transform = "translateY(6px)";
      toastTimerId = null;
    }, tone === "error" ? 2800 : 1800);
  }

  function getRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function parsePixels(value) {
    const next = Number.parseFloat(value);
    return Number.isFinite(next) ? next : 0;
  }

  function getBoxModel(element, rect) {
    const styles = window.getComputedStyle(element);
    const margin = {
      top: parsePixels(styles.marginTop),
      right: parsePixels(styles.marginRight),
      bottom: parsePixels(styles.marginBottom),
      left: parsePixels(styles.marginLeft),
    };
    const padding = {
      top: parsePixels(styles.paddingTop),
      right: parsePixels(styles.paddingRight),
      bottom: parsePixels(styles.paddingBottom),
      left: parsePixels(styles.paddingLeft),
    };
    const border = {
      top: parsePixels(styles.borderTopWidth),
      right: parsePixels(styles.borderRightWidth),
      bottom: parsePixels(styles.borderBottomWidth),
      left: parsePixels(styles.borderLeftWidth),
    };

    return {
      margin,
      padding,
      border,
      marginRect: {
        x: rect.x - margin.left,
        y: rect.y - margin.top,
        width: rect.width + margin.left + margin.right,
        height: rect.height + margin.top + margin.bottom,
      },
      paddingRect: {
        x: rect.x + border.left,
        y: rect.y + border.top,
        width: Math.max(0, rect.width - border.left - border.right),
        height: Math.max(0, rect.height - border.top - border.bottom),
      },
      contentRect: {
        x: rect.x + border.left + padding.left,
        y: rect.y + border.top + padding.top,
        width: Math.max(0, rect.width - border.left - border.right - padding.left - padding.right),
        height: Math.max(0, rect.height - border.top - border.bottom - padding.top - padding.bottom),
      },
    };
  }

  function getTextPreview(element) {
    return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  function getDataset(element) {
    return Object.fromEntries(
      Array.from(element.attributes)
        .filter((attribute) => attribute.name.startsWith("data-"))
        .map((attribute) => [attribute.name, attribute.value]),
    );
  }

  function createSelector(element) {
    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const dataAgentId = element.getAttribute("data-agent-id");
    if (dataAgentId) {
      return `[data-agent-id="${dataAgentId}"]`;
    }

    const dataTestId = element.getAttribute("data-testid");
    if (dataTestId) {
      return `[data-testid="${dataTestId}"]`;
    }

    const classNames = Array.from(element.classList).filter(Boolean);
    if (classNames.length > 0) {
      return `${element.tagName.toLowerCase()}.${classNames
        .slice(0, 2)
        .map(cssEscape)
        .join(".")}`;
    }

    return element.tagName.toLowerCase();
  }

  function createSelectorPath(element) {
    const segments = [];
    let current = element;

    while (current && current.tagName.toLowerCase() !== "html") {
      const tagName = current.tagName.toLowerCase();
      if (current.id) {
        segments.unshift(`${tagName}#${cssEscape(current.id)}`);
        break;
      }

      const parent = current.parentElement;
      if (!parent) {
        segments.unshift(tagName);
        break;
      }

      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current.tagName,
      );
      const index = siblings.indexOf(current) + 1;
      segments.unshift(`${tagName}:nth-of-type(${index})`);
      current = parent;
    }

    return segments.join(" > ");
  }

  function getTypography(element) {
    const textPreview = getTextPreview(element);
    if (!textPreview) {
      return null;
    }

    const styles = window.getComputedStyle(element);
    return {
      fontSize: styles.fontSize,
      fontFamily: styles.fontFamily,
      fontWeight: styles.fontWeight,
    };
  }

  function toSelectionElementRecord(element) {
    const rect = getRect(element);
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      classNames: Array.from(element.classList).filter(Boolean),
      role: element.getAttribute("role"),
      textPreview: getTextPreview(element),
      selector: createSelector(element),
      selectorPath: createSelectorPath(element),
      dataset: getDataset(element),
      rect,
      boxModel: getBoxModel(element, rect),
      typography: getTypography(element),
      outerHTMLSnippet: element.outerHTML.slice(0, 1200),
    };
  }

  function getPageTargetElement() {
    return (
      document.querySelector("main, [role='main']") ||
      document.body ||
      document.documentElement
    );
  }

  function buildPageContext(element) {
    return {
      page: {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
      },
      element: toSelectionElementRecord(element),
    };
  }

  function updateOverlay(element) {
    ensureUi();

    if (!element || isUiElement(element)) {
      hoveredElement = null;
      outlineElement.style.display = "none";
      labelElement.style.display = "none";
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      hoveredElement = null;
      outlineElement.style.display = "none";
      labelElement.style.display = "none";
      return;
    }

    hoveredElement = element;
    outlineElement.style.display = "block";
    outlineElement.style.left = `${rect.left}px`;
    outlineElement.style.top = `${rect.top}px`;
    outlineElement.style.width = `${rect.width}px`;
    outlineElement.style.height = `${rect.height}px`;

    labelElement.style.display = "block";
    labelElement.textContent = `${element.tagName.toLowerCase()} ${createSelector(element)}`;
    labelElement.style.left = `${Math.max(8, rect.left)}px`;
    labelElement.style.top = `${Math.max(8, rect.top - 30)}px`;
  }

  function stopInspectMode() {
    isInspecting = false;
    hoveredElement = null;
    if (outlineElement) {
      outlineElement.style.display = "none";
    }
    if (labelElement) {
      labelElement.style.display = "none";
    }

    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
  }

  function startInspectMode() {
    if (isInspecting) {
      return;
    }

    ensureUi();
    isInspecting = true;
    setToast("Inspect mode on. Click the target element or press Esc.", "info");

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  function handleMouseMove(event) {
    if (!isInspecting) {
      return;
    }

    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || isUiElement(target)) {
      updateOverlay(null);
      return;
    }

    updateOverlay(target);
  }

  function handleClick(event) {
    if (!isInspecting) {
      return;
    }

    const target = getTargetElement(event.target) || hoveredElement;
    if (!target || isUiElement(target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    stopInspectMode();
    setToast("Saving the picked element...", "info");
    chrome.runtime.sendMessage({
      type: "agent-picker:inspect-picked",
      pageContext: buildPageContext(target),
    });
  }

  function handleKeyDown(event) {
    if (!isInspecting || event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    stopInspectMode();
    setToast("Inspect mode cancelled.", "info");
    chrome.runtime.sendMessage({ type: "agent-picker:cancel-inspect" });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case "agent-picker:collect-page": {
        sendResponse({
          ok: true,
          pageContext: buildPageContext(getPageTargetElement()),
        });
        return false;
      }
      case "agent-picker:start-inspect": {
        startInspectMode();
        sendResponse({ ok: true });
        return false;
      }
      case "agent-picker:inspect-result": {
        if (message.ok) {
          setToast(message.message || "Element saved.", "info");
        } else {
          setToast(message.message || "Failed to save the picked element.", "error");
        }
        sendResponse({ ok: true });
        return false;
      }
      default:
        return false;
    }
  });
})();
