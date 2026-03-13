function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
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
    return `${element.tagName.toLowerCase()}.${classNames.slice(0, 2).map(cssEscape).join(".")}`;
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

    const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
    segments.unshift(`${tagName}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = parent;
  }

  return segments.join(" > ");
}

function getTypography(element) {
  if (!getTextPreview(element)) {
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
  return document.querySelector("main, [role='main']") || document.body || document.documentElement;
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
