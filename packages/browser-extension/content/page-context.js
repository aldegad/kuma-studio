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

function normalizePreviewText(value, maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function getDataset(element) {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => [attribute.name, attribute.value]),
  );
}

function getTextByIdReferences(value) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  return value
    .split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter((element) => element instanceof Element)
    .map((element) => normalizePreviewText(element.textContent, 160))
    .filter(Boolean);
}

function getAssociatedLabelTexts(element) {
  const labels = new Set();
  const pushText = (value) => {
    const text = normalizePreviewText(value, 160);
    if (text) {
      labels.add(text);
    }
  };

  if (element instanceof Element) {
    pushText(element.getAttribute("aria-label"));
    for (const text of getTextByIdReferences(element.getAttribute("aria-labelledby"))) {
      pushText(text);
    }
  }

  if ("labels" in element && Array.isArray(Array.from(element.labels ?? []))) {
    for (const label of Array.from(element.labels ?? [])) {
      pushText(label?.textContent);
    }
  }

  const wrappingLabel = element.closest?.("label");
  if (wrappingLabel) {
    pushText(wrappingLabel.textContent);
  }

  if (labels.size > 0) {
    return [...labels];
  }

  let current = element.parentElement;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const siblingLabels = Array.from(current.children).filter((candidate) => {
      return (
        candidate instanceof Element &&
        (candidate.tagName === "LABEL" || candidate.tagName === "LEGEND") &&
        !candidate.contains(element)
      );
    });

    for (const candidate of siblingLabels) {
      if (!(candidate instanceof Element)) {
        continue;
      }

      pushText(candidate.textContent);
    }

    if (siblingLabels.length > 0) {
      break;
    }

    current = current.parentElement;
  }

  return [...labels];
}

function getPrimaryLabel(element) {
  return getAssociatedLabelTexts(element)[0] ?? null;
}

function getValuePreview(value) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  const normalized = normalizePreviewText(text, 240);
  return normalized || null;
}

function getElementState(element) {
  const baseState = {
    label: getPrimaryLabel(element),
    value: null,
    valuePreview: null,
    checked: null,
    selectedValue: null,
    selectedValues: [],
    placeholder: null,
    required: false,
    disabled: false,
    readOnly: false,
    multiple: false,
    inputType: null,
  };

  if (!(element instanceof Element)) {
    return baseState;
  }

  if (element instanceof HTMLInputElement) {
    const inputType = normalizePreviewText(element.type || "text", 32) || "text";
    const isSensitiveInput = inputType === "password" || inputType === "file";
    const value = isSensitiveInput ? null : element.value;

    return {
      ...baseState,
      value,
      valuePreview: isSensitiveInput ? null : getValuePreview(element.value),
      checked: ["checkbox", "radio"].includes(inputType) ? element.checked : null,
      placeholder: normalizePreviewText(element.placeholder, 160) || null,
      required: element.required,
      disabled: element.disabled,
      readOnly: element.readOnly,
      inputType,
    };
  }

  if (element instanceof HTMLTextAreaElement) {
    return {
      ...baseState,
      value: element.value,
      valuePreview: getValuePreview(element.value),
      placeholder: normalizePreviewText(element.placeholder, 160) || null,
      required: element.required,
      disabled: element.disabled,
      readOnly: element.readOnly,
      inputType: "textarea",
    };
  }

  if (element instanceof HTMLSelectElement) {
    const selectedValues = Array.from(element.selectedOptions)
      .map((option) => option?.value)
      .filter((value) => typeof value === "string");
    const selectedValue = selectedValues[0] ?? null;

    return {
      ...baseState,
      value: selectedValue,
      valuePreview: getValuePreview(selectedValue),
      selectedValue,
      selectedValues,
      required: element.required,
      disabled: element.disabled,
      readOnly: false,
      multiple: element.multiple,
      inputType: "select",
    };
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    const value = element.textContent || "";
    return {
      ...baseState,
      value,
      valuePreview: getValuePreview(value),
      disabled: element.getAttribute("aria-disabled") === "true",
      readOnly: element.getAttribute("aria-readonly") === "true",
      inputType: "contenteditable",
    };
  }

  return baseState;
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
  const state = getElementState(element);
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classNames: Array.from(element.classList).filter(Boolean),
    role: element.getAttribute("role"),
    label: state.label,
    textPreview: getTextPreview(element),
    value: state.value,
    valuePreview: state.valuePreview,
    checked: state.checked,
    selectedValue: state.selectedValue,
    selectedValues: state.selectedValues,
    placeholder: state.placeholder,
    required: state.required,
    disabled: state.disabled,
    readOnly: state.readOnly,
    multiple: state.multiple,
    inputType: state.inputType,
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

function getViewportMetrics() {
  return {
    width: window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function normalizeSelectionRect(rect) {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

function buildAreaSelectionRecord(rect) {
  const normalizedRect = normalizeSelectionRect(rect);
  const selector = `area:${normalizedRect.x},${normalizedRect.y},${normalizedRect.width},${normalizedRect.height}`;

  return {
    tagName: "area-selection",
    id: null,
    classNames: [],
    role: null,
    textPreview: "",
    selector,
    selectorPath: selector,
    dataset: {},
    rect: normalizedRect,
    boxModel: {
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      marginRect: normalizedRect,
      paddingRect: normalizedRect,
      contentRect: normalizedRect,
    },
    typography: null,
    outerHTMLSnippet: "<!-- area selection -->",
  };
}

function buildPageRecord() {
  return {
    url: window.location.href,
    pathname: window.location.pathname,
    title: document.title,
  };
}

function buildPageContext(element) {
  return {
    page: buildPageRecord(),
    element: toSelectionElementRecord(element),
    viewport: getViewportMetrics(),
  };
}

function buildAreaPageContext(rect) {
  return {
    page: buildPageRecord(),
    element: buildAreaSelectionRecord(rect),
    viewport: getViewportMetrics(),
  };
}
