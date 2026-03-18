const {
  normalizeText,
  normalizeRole,
  isExtensionUiElement,
  isVisibleElement,
  describeElementForCommand,
  getFillableElements,
  findBestFillableByLabel,
  getVisibleDialogs,
  getScopeRoot,
  findElementByTextWithinRoot,
  findElementBySelectorWithinRoot,
  getLastObservedSelectorState,
  getAccessibleText,
  scoreTextMatch,
  buildDomSnapshot,
} = globalThis.AgentPickerExtensionAgentActionCore;
const {
  waitForDelay,
  executeClickCommand,
  executeClickPointCommand,
  executeFillCommand,
  executeKeyCommand,
} = globalThis.AgentPickerExtensionAgentActionInteraction;

function readTimeoutMs(command, fallbackMs = 15_000) {
  return typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs)
    ? Math.max(100, Math.min(120_000, Math.round(command.timeoutMs)))
    : fallbackMs;
}

async function pollUntil(command, evaluator) {
  const timeoutMs = readTimeoutMs(command);
  const startedAt = Date.now();
  let lastObserved = null;

  while (Date.now() - startedAt <= timeoutMs) {
    const observation = evaluator();
    lastObserved = observation?.lastObserved ?? lastObserved;
    if (observation?.matched) {
      return {
        matched: true,
        waitedMs: Date.now() - startedAt,
        ...observation.result,
      };
    }
    await waitForDelay(100);
  }

  const details = lastObserved ? ` Last observed: ${JSON.stringify(lastObserved)}.` : "";
  const timeoutError = new Error(`Timed out after ${timeoutMs}ms.${details}`);
  timeoutError.lastObserved = lastObserved;
  throw timeoutError;
}

async function executeWaitForTextCommand(command, expectPresent) {
  const text = normalizeText(command?.text);
  if (!text) {
    throw new Error(expectPresent ? "browser-wait-for-text requires --text." : "browser-wait-for-text-disappear requires --text.");
  }

  const scopeRoot = getScopeRoot(command?.scope);
  if (!scopeRoot) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }

  const result = await pollUntil(command, () => {
    const haystack = normalizeText(scopeRoot.innerText || scopeRoot.textContent || "");
    const present = haystack.includes(text);
    return {
      matched: expectPresent ? present : !present,
      lastObserved: { text, present, scope: command?.scope === "dialog" ? "dialog" : "page" },
      result: { text, scope: command?.scope === "dialog" ? "dialog" : "page" },
    };
  });

  return { page: buildPageRecord(), ...result };
}

async function executeWaitForSelectorCommand(command) {
  const selector = command?.selectorPath || command?.selector;
  if (!selector) {
    throw new Error("browser-wait-for-selector requires --selector or --selector-path.");
  }

  const scopeRoot = getScopeRoot(command?.scope);
  if (!scopeRoot) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }

  const result = await pollUntil(command, () => {
    const target = findElementBySelectorWithinRoot(selector, scopeRoot);
    return {
      matched: target instanceof Element,
      lastObserved: getLastObservedSelectorState(selector, scopeRoot),
      result: {
        selector,
        scope: command?.scope === "dialog" ? "dialog" : "page",
        element: target instanceof Element ? describeElementForCommand(target) : null,
      },
    };
  });

  return { page: buildPageRecord(), ...result };
}

async function executeWaitForDialogCloseCommand(command) {
  const result = await pollUntil(command, () => {
    const dialogs = getVisibleDialogs();
    return {
      matched: dialogs.length === 0,
      lastObserved: { openDialogCount: dialogs.length },
      result: { openDialogCount: dialogs.length },
    };
  });

  return { page: buildPageRecord(), ...result };
}

function serializeQueryResult(element) {
  const record = describeElementForCommand(element);
  const textContent = normalizeText(element.textContent).slice(0, 400) || null;
  const displayValue =
    element instanceof HTMLSelectElement
      ? normalizeText(Array.from(element.selectedOptions).map((option) => option.textContent).join(" ")) || null
      : record.valuePreview ?? record.value ?? null;

  return {
    label: record.label,
    tagName: record.tagName,
    role: record.role,
    selector: record.selector,
    selectorPath: record.selectorPath,
    value: record.value,
    displayValue,
    valuePreview: record.valuePreview,
    checked: record.checked,
    selectedValue: record.selectedValue,
    selectedValues: record.selectedValues,
    required: record.required,
    placeholder: record.placeholder,
    disabled: record.disabled,
    readOnly: record.readOnly,
    multiple: record.multiple,
    inputType: record.inputType,
    ariaSelected: element.getAttribute("aria-selected") == null ? null : element.getAttribute("aria-selected") === "true",
    ariaInvalid: element.getAttribute("aria-invalid") == null ? null : element.getAttribute("aria-invalid") === "true",
    ariaExpanded: element.getAttribute("aria-expanded") == null ? null : element.getAttribute("aria-expanded") === "true",
    ariaHaspopup: element.getAttribute("aria-haspopup") || null,
    ariaControls: element.getAttribute("aria-controls") || null,
    open: element.hasAttribute("open"),
    visible: isVisibleElement(element),
    textContent,
    rect: record.rect,
  };
}

function getAssociatedLabelSummary(element) {
  return typeof getAssociatedLabelTexts === "function"
    ? getAssociatedLabelTexts(element).map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
}

function findElementsByAssociatedLabel(root, labelText) {
  const normalizedNeedle = normalizeText(labelText);
  if (!normalizedNeedle || !(root instanceof Element)) {
    return [];
  }

  return Array.from(root.querySelectorAll("input, textarea, select, [role='combobox'], [role='listbox'], [role='tab'], button, summary"))
    .filter((element) => element instanceof Element && isVisibleElement(element))
    .map((element) => ({
      element,
      score: getAssociatedLabelSummary(element).reduce((best, label) => Math.max(best, scoreTextMatch(label, normalizedNeedle)), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

function filterSemanticMatches(elements, text) {
  const normalizedNeedle = normalizeText(text);
  if (!normalizedNeedle) {
    return [...elements];
  }

  return elements
    .map((element) => {
      const accessibleText = getAccessibleText(element);
      const labelScore = getAssociatedLabelSummary(element).reduce(
        (best, label) => Math.max(best, scoreTextMatch(label, normalizedNeedle)),
        0,
      );
      return { element, score: Math.max(scoreTextMatch(accessibleText, normalizedNeedle), labelScore) };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.element);
}

function getControlledElement(element) {
  const controlsId = element.getAttribute("aria-controls");
  if (!controlsId) {
    return null;
  }
  const target = document.getElementById(controlsId);
  return target instanceof Element ? target : null;
}

function serializeControlledElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }
  const record = describeElementForCommand(element);
  return {
    tagName: record.tagName,
    role: record.role,
    selector: record.selector,
    selectorPath: record.selectorPath,
    visible: isVisibleElement(element),
  };
}

function readOptionLikeState(element) {
  if (element instanceof HTMLSelectElement) {
    return {
      optionCount: element.options.length,
      selectedOptions: Array.from(element.selectedOptions).map((option) => ({
        text: normalizeText(option.textContent) || null,
        value: option.value || null,
        selected: option.selected === true,
      })),
    };
  }

  const controlledElement = getControlledElement(element);
  const optionRoot =
    normalizeRole(element.getAttribute("role")) === "listbox"
      ? element
      : normalizeRole(controlledElement?.getAttribute?.("role")) === "listbox"
        ? controlledElement
        : controlledElement instanceof Element
          ? controlledElement
          : element;
  const options = Array.from(optionRoot.querySelectorAll("[role='option'], option")).filter(
    (option) => option instanceof Element && !isExtensionUiElement(option),
  );

  return {
    optionCount: options.length,
    selectedOptions: options
      .filter((option) => {
        if (option instanceof HTMLOptionElement) {
          return option.selected === true;
        }
        return option.getAttribute("aria-selected") === "true" || option.getAttribute("aria-checked") === "true";
      })
      .map((option) => ({
        text: normalizeText(option.textContent) || null,
        value: "value" in option ? option.value || null : null,
        selected: true,
        selector: createSelector(option),
        selectorPath: createSelectorPath(option),
      })),
  };
}

function getQueryableRoot(scope) {
  const root = getScopeRoot(scope);
  if (!root) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }
  return root;
}

function queryRequiredFields(scope) {
  const root = getQueryableRoot(scope);
  return getFillableElements(root).filter((element) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      ? element.required || element.getAttribute("aria-required") === "true"
      : element.getAttribute("aria-required") === "true",
  );
}

function queryAllTextareas(scope) {
  return Array.from(getQueryableRoot(scope).querySelectorAll("textarea")).filter(isVisibleElement);
}

function queryNearbyInput(scope, text) {
  const root = getQueryableRoot(scope);
  const target = findBestFillableByLabel(text, root) ?? (() => {
    const anchor = findElementByTextWithinRoot(text, root);
    if (!(anchor instanceof Element)) {
      return null;
    }

    let current = anchor instanceof HTMLLabelElement ? anchor : anchor.closest("label, fieldset, form, section, div");
    for (let depth = 0; depth < 3 && current; depth += 1) {
      const candidate = current.querySelector?.("input, textarea, select, [contenteditable='true']");
      if (candidate instanceof Element && isVisibleElement(candidate)) {
        return candidate;
      }
      current = current.parentElement;
    }
    return null;
  })();

  return target ? [target] : [];
}

function queryInputByLabel(scope, text) {
  const target = findBestFillableByLabel(text, getQueryableRoot(scope));
  return target ? [target] : [];
}

function queryMenuState(scope, text) {
  const root = getQueryableRoot(scope);
  const menuLikeElements = Array.from(
    root.querySelectorAll(
      "select, summary, [role='combobox'], [role='listbox'], [role='menu'], [aria-haspopup='menu'], [aria-haspopup='listbox'], [aria-expanded]",
    ),
  ).filter(isVisibleElement);

  const combined = [...menuLikeElements];
  for (const match of findElementsByAssociatedLabel(root, text)) {
    if (!combined.includes(match.element)) {
      combined.push(match.element);
    }
  }
  return filterSemanticMatches(combined, text);
}

function querySelectedOption(scope, text) {
  const root = getQueryableRoot(scope);
  const labelTarget = findBestFillableByLabel(text, root);
  if (
    labelTarget instanceof HTMLSelectElement ||
    normalizeRole(labelTarget?.getAttribute?.("role")) === "listbox" ||
    normalizeRole(labelTarget?.getAttribute?.("role")) === "combobox"
  ) {
    return [labelTarget];
  }
  return filterSemanticMatches(Array.from(root.querySelectorAll("select, [role='listbox'], [role='combobox']")).filter(isVisibleElement), text);
}

function queryTabState(scope, text) {
  return filterSemanticMatches(Array.from(getQueryableRoot(scope).querySelectorAll("[role='tab']")).filter(isVisibleElement), text);
}

function executeQueryDomCommand(command) {
  const kind = normalizeText(command?.kind).toLowerCase();
  const text = normalizeText(command?.text);
  const scope = command?.scope === "dialog" ? "dialog" : "page";

  const queryMap = {
    "required-fields": { elements: queryRequiredFields(scope), serializer: serializeQueryResult },
    "all-textareas": { elements: queryAllTextareas(scope), serializer: serializeQueryResult },
    "nearby-input": { elements: text ? queryNearbyInput(scope, text) : null, serializer: serializeQueryResult, requiresText: true },
    "input-by-label": { elements: text ? queryInputByLabel(scope, text) : null, serializer: serializeQueryResult, requiresText: true },
    "menu-state": {
      elements: text ? queryMenuState(scope, text) : null,
      serializer(element) {
        const optionState = readOptionLikeState(element);
        return {
          ...serializeQueryResult(element),
          controlledElement: serializeControlledElement(getControlledElement(element)),
          optionCount: optionState.optionCount,
          selectedOptions: optionState.selectedOptions,
        };
      },
      requiresText: true,
    },
    "selected-option": {
      elements: text ? querySelectedOption(scope, text) : null,
      serializer(element) {
        const optionState = readOptionLikeState(element);
        return { ...serializeQueryResult(element), optionCount: optionState.optionCount, selectedOptions: optionState.selectedOptions };
      },
      requiresText: true,
    },
    "tab-state": {
      elements: text ? queryTabState(scope, text) : null,
      serializer(element) {
        const controlledElement = getControlledElement(element);
        return {
          ...serializeQueryResult(element),
          selected: element.getAttribute("aria-selected") == null ? null : element.getAttribute("aria-selected") === "true",
          controlledElement: serializeControlledElement(controlledElement),
          controlledVisible: controlledElement ? isVisibleElement(controlledElement) : null,
        };
      },
      requiresText: true,
    },
  };

  const definition = queryMap[kind];
  if (!definition) {
    throw new Error(`Unsupported browser-query-dom kind: ${String(command?.kind)}`);
  }
  if (definition.requiresText && !text) {
    throw new Error(`browser-query-dom --kind ${kind} requires --text.`);
  }

  return {
    page: buildPageRecord(),
    kind,
    scope,
    count: definition.elements.length,
    results: definition.elements.map(definition.serializer),
  };
}

async function executeBrowserCommand(command) {
  switch (command?.type) {
    case "context":
      return { pageContext: buildPageContext(getPageTargetElement()) };
    case "dom":
      return { domSnapshot: buildDomSnapshot() };
    case "click":
      return executeClickCommand(command);
    case "click-point":
      return executeClickPointCommand(command);
    case "fill":
      return executeFillCommand(command);
    case "key":
      return executeKeyCommand(command);
    case "wait-for-text":
      return executeWaitForTextCommand(command, true);
    case "wait-for-text-disappear":
      return executeWaitForTextCommand(command, false);
    case "wait-for-selector":
      return executeWaitForSelectorCommand(command);
    case "wait-for-dialog-close":
      return executeWaitForDialogCloseCommand(command);
    case "query-dom":
      return executeQueryDomCommand(command);
    default:
      throw new Error(`Unsupported Agent Picker browser command: ${String(command?.type)}`);
  }
}

globalThis.AgentPickerExtensionAgentActions = { executeBrowserCommand };
