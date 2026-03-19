(() => {
var {
  normalizeText: coreNormalizeText,
  normalizeRole: coreNormalizeRole,
  isExtensionUiElement: coreIsExtensionUiElement,
  isVisibleElement: coreIsVisibleElement,
  describeElementForCommand: coreDescribeElementForCommand,
  getFillableElements: coreGetFillableElements,
  findBestFillableByLabel: coreFindBestFillableByLabel,
  getVisibleDialogs: coreGetVisibleDialogs,
  getScopeRoot: coreGetScopeRoot,
  findElementByTextWithinRoot: coreFindElementByTextWithinRoot,
  findElementBySelectorWithinRoot: coreFindElementBySelectorWithinRoot,
  getLastObservedSelectorState: coreGetLastObservedSelectorState,
  getAccessibleText: coreGetAccessibleText,
  scoreTextMatch: coreScoreTextMatch,
  buildDomSnapshot: coreBuildDomSnapshot,
} = globalThis.AgentPickerExtensionAgentActionCore;
var {
  waitForDelay: interactionWaitForDelay,
  executeClickCommand: interactionExecuteClickCommand,
  executeClickPointCommand: interactionExecuteClickPointCommand,
  executeFillCommand: interactionExecuteFillCommand,
  executeKeyCommand: interactionExecuteKeyCommand,
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
    await interactionWaitForDelay(100);
  }

  const details = lastObserved ? ` Last observed: ${JSON.stringify(lastObserved)}.` : "";
  const timeoutError = new Error(`Timed out after ${timeoutMs}ms.${details}`);
  timeoutError.lastObserved = lastObserved;
  throw timeoutError;
}

async function executeWaitForTextCommand(command, expectPresent) {
  const text = coreNormalizeText(command?.text);
  if (!text) {
    throw new Error(expectPresent ? "browser-wait-for-text requires --text." : "browser-wait-for-text-disappear requires --text.");
  }

  const scopeRoot = coreGetScopeRoot(command?.scope);
  if (!scopeRoot) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }

  const result = await pollUntil(command, () => {
    const haystack = coreNormalizeText(scopeRoot.innerText || scopeRoot.textContent || "");
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

  const scopeRoot = coreGetScopeRoot(command?.scope);
  if (!scopeRoot) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }

  const result = await pollUntil(command, () => {
    const target = coreFindElementBySelectorWithinRoot(selector, scopeRoot);
    return {
      matched: target instanceof Element,
      lastObserved: coreGetLastObservedSelectorState(selector, scopeRoot),
      result: {
        selector,
        scope: command?.scope === "dialog" ? "dialog" : "page",
        element: target instanceof Element ? coreDescribeElementForCommand(target) : null,
      },
    };
  });

  return { page: buildPageRecord(), ...result };
}

async function executeWaitForDialogCloseCommand(command) {
  const result = await pollUntil(command, () => {
    const dialogs = coreGetVisibleDialogs();
    return {
      matched: dialogs.length === 0,
      lastObserved: { openDialogCount: dialogs.length },
      result: { openDialogCount: dialogs.length },
    };
  });

  return { page: buildPageRecord(), ...result };
}

function executeMeasureCommand(command) {
  const selector = command?.selectorPath || command?.selector;
  if (!selector) {
    throw new Error("The measure command requires --selector or --selector-path.");
  }

  const scopeRoot = coreGetScopeRoot(command?.scope);
  if (!scopeRoot) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }

  const target = coreFindElementBySelectorWithinRoot(selector, scopeRoot);
  if (!(target instanceof Element)) {
    throw new Error(`Failed to find an element that matches ${selector}.`);
  }

  return {
    page: buildPageRecord(),
    scope: command?.scope === "dialog" ? "dialog" : "page",
    selector,
    element: coreDescribeElementForCommand(target),
    rect: target.getBoundingClientRect(),
  };
}

function serializeQueryResult(element) {
  const record = coreDescribeElementForCommand(element);
  const textContent = coreNormalizeText(element.textContent).slice(0, 400) || null;
  const displayValue =
    element instanceof HTMLSelectElement
      ? coreNormalizeText(Array.from(element.selectedOptions).map((option) => option.textContent).join(" ")) || null
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
    visible: coreIsVisibleElement(element),
    textContent,
    rect: record.rect,
  };
}

function getAssociatedLabelSummary(element) {
  return typeof getAssociatedLabelTexts === "function"
    ? getAssociatedLabelTexts(element).map((entry) => coreNormalizeText(entry)).filter(Boolean)
    : [];
}

function findElementsByAssociatedLabel(root, labelText) {
  const normalizedNeedle = coreNormalizeText(labelText);
  if (!normalizedNeedle || !(root instanceof Element)) {
    return [];
  }

  return Array.from(root.querySelectorAll("input, textarea, select, [role='combobox'], [role='listbox'], [role='tab'], button, summary"))
    .filter((element) => element instanceof Element && coreIsVisibleElement(element))
    .map((element) => ({
      element,
      score: getAssociatedLabelSummary(element).reduce((best, label) => Math.max(best, coreScoreTextMatch(label, normalizedNeedle)), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

function filterSemanticMatches(elements, text) {
  const normalizedNeedle = coreNormalizeText(text);
  if (!normalizedNeedle) {
    return [...elements];
  }

  return elements
    .map((element) => {
      const accessibleText = coreGetAccessibleText(element);
      const labelScore = getAssociatedLabelSummary(element).reduce(
        (best, label) => Math.max(best, coreScoreTextMatch(label, normalizedNeedle)),
        0,
      );
      return { element, score: Math.max(coreScoreTextMatch(accessibleText, normalizedNeedle), labelScore) };
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
  const record = coreDescribeElementForCommand(element);
  return {
    tagName: record.tagName,
    role: record.role,
    selector: record.selector,
    selectorPath: record.selectorPath,
    visible: coreIsVisibleElement(element),
  };
}

function readOptionLikeState(element) {
  if (element instanceof HTMLSelectElement) {
    return {
      optionCount: element.options.length,
      selectedOptions: Array.from(element.selectedOptions).map((option) => ({
        text: coreNormalizeText(option.textContent) || null,
        value: option.value || null,
        selected: option.selected === true,
      })),
    };
  }

  const controlledElement = getControlledElement(element);
  const optionRoot =
    coreNormalizeRole(element.getAttribute("role")) === "listbox"
      ? element
      : coreNormalizeRole(controlledElement?.getAttribute?.("role")) === "listbox"
        ? controlledElement
        : controlledElement instanceof Element
          ? controlledElement
          : element;
  const options = Array.from(optionRoot.querySelectorAll("[role='option'], option")).filter(
    (option) => option instanceof Element && !coreIsExtensionUiElement(option),
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
        text: coreNormalizeText(option.textContent) || null,
        value: "value" in option ? option.value || null : null,
        selected: true,
        selector: createSelector(option),
        selectorPath: createSelectorPath(option),
      })),
  };
}

function getQueryableRoot(scope) {
  const root = coreGetScopeRoot(scope);
  if (!root) {
    throw new Error("No visible dialog is open for the requested dialog scope.");
  }
  return root;
}

function queryRequiredFields(scope) {
  const root = getQueryableRoot(scope);
  return coreGetFillableElements(root).filter((element) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      ? element.required || element.getAttribute("aria-required") === "true"
      : element.getAttribute("aria-required") === "true",
  );
}

function queryAllTextareas(scope) {
  return Array.from(getQueryableRoot(scope).querySelectorAll("textarea")).filter(coreIsVisibleElement);
}

function queryNearbyInput(scope, text) {
  const root = getQueryableRoot(scope);
  const target = coreFindBestFillableByLabel(text, root) ?? (() => {
    const anchor = coreFindElementByTextWithinRoot(text, root);
    if (!(anchor instanceof Element)) {
      return null;
    }

    let current = anchor instanceof HTMLLabelElement ? anchor : anchor.closest("label, fieldset, form, section, div");
    for (let depth = 0; depth < 3 && current; depth += 1) {
      const candidate = current.querySelector?.("input, textarea, select, [contenteditable='true']");
      if (candidate instanceof Element && coreIsVisibleElement(candidate)) {
        return candidate;
      }
      current = current.parentElement;
    }
    return null;
  })();

  return target ? [target] : [];
}

function queryInputByLabel(scope, text) {
  const target = coreFindBestFillableByLabel(text, getQueryableRoot(scope));
  return target ? [target] : [];
}

function queryMenuState(scope, text) {
  const root = getQueryableRoot(scope);
  const menuLikeElements = Array.from(
    root.querySelectorAll(
      "select, summary, [role='combobox'], [role='listbox'], [role='menu'], [aria-haspopup='menu'], [aria-haspopup='listbox'], [aria-expanded]",
    ),
  ).filter(coreIsVisibleElement);

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
  const labelTarget = coreFindBestFillableByLabel(text, root);
  if (
    labelTarget instanceof HTMLSelectElement ||
    coreNormalizeRole(labelTarget?.getAttribute?.("role")) === "listbox" ||
    coreNormalizeRole(labelTarget?.getAttribute?.("role")) === "combobox"
  ) {
    return [labelTarget];
  }
  return filterSemanticMatches(Array.from(root.querySelectorAll("select, [role='listbox'], [role='combobox']")).filter(coreIsVisibleElement), text);
}

function queryTabState(scope, text) {
  return filterSemanticMatches(Array.from(getQueryableRoot(scope).querySelectorAll("[role='tab']")).filter(coreIsVisibleElement), text);
}

function executeQueryDomCommand(command) {
  const kind = coreNormalizeText(command?.kind).toLowerCase();
  const text = coreNormalizeText(command?.text);
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
          controlledVisible: controlledElement ? coreIsVisibleElement(controlledElement) : null,
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

const SEQUENCE_STEP_TYPES = new Set([
  "click",
  "click-point",
  "fill",
  "key",
  "wait-for-text",
  "wait-for-text-disappear",
  "wait-for-selector",
  "wait-for-dialog-close",
  "query-dom",
  "measure",
  "dom",
  "console",
]);

const SEQUENCE_ASSERTION_TYPES = new Set([
  "wait-for-text",
  "wait-for-text-disappear",
  "wait-for-selector",
  "wait-for-dialog-close",
]);

function normalizeSequenceSteps(command) {
  if (!Array.isArray(command?.steps) || command.steps.length === 0) {
    throw new Error("The browser sequence command requires a non-empty steps array.");
  }

  return command.steps;
}

function normalizeSequenceAssertions(step) {
  if (!Array.isArray(step?.assertions) || step.assertions.length === 0) {
    return [];
  }

  return step.assertions;
}

async function executeSequenceAssertions(assertions, stepIndex) {
  const results = [];

  for (let assertionIndex = 0; assertionIndex < assertions.length; assertionIndex += 1) {
    const assertion = assertions[assertionIndex];
    const type = coreNormalizeText(assertion?.type).toLowerCase();
    if (!SEQUENCE_ASSERTION_TYPES.has(type)) {
      throw new Error(
        `Sequence step ${stepIndex + 1} assertion ${assertionIndex + 1} uses unsupported type "${String(assertion?.type)}".`,
      );
    }

    try {
      const result = await executeBrowserCommandInternal({ ...assertion, type }, { allowSequence: false });
      results.push({
        index: assertionIndex + 1,
        type,
        result,
      });
    } catch (error) {
      throw new Error(
        `Sequence step ${stepIndex + 1} assertion ${assertionIndex + 1} (${type}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return results;
}

async function executeSequenceCommand(command) {
  const steps = normalizeSequenceSteps(command);
  const completedSteps = [];

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`Sequence step ${stepIndex + 1} must be an object.`);
    }

    const type = coreNormalizeText(step?.type).toLowerCase();
    if (!SEQUENCE_STEP_TYPES.has(type)) {
      throw new Error(`Sequence step ${stepIndex + 1} uses unsupported type "${String(step?.type)}".`);
    }

    const { assertions, ...stepCommand } = step;

    try {
      const result = await executeBrowserCommandInternal({ ...stepCommand, type }, { allowSequence: false });
      completedSteps.push({
        index: stepIndex + 1,
        type,
        label: typeof step.label === "string" && step.label.trim() ? step.label.trim() : null,
        result,
        assertions: await executeSequenceAssertions(normalizeSequenceAssertions(step), stepIndex),
      });
    } catch (error) {
      throw new Error(`Sequence step ${stepIndex + 1} (${type}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    page: buildPageRecord(),
    stepCount: completedSteps.length,
    steps: completedSteps,
  };
}

async function executeBrowserCommandInternal(command, options = {}) {
  const allowSequence = options.allowSequence !== false;
  switch (command?.type) {
    case "context":
      return { pageContext: buildPageContext(getPageTargetElement()) };
    case "dom":
      return { domSnapshot: coreBuildDomSnapshot() };
    case "console":
      return {
        page: buildPageRecord(),
        ...(globalThis.AgentPickerExtensionRuntimeObserver?.readEntries?.() ?? {
          count: 0,
          entries: [],
        }),
      };
    case "click":
      return interactionExecuteClickCommand(command);
    case "sequence":
      if (!allowSequence) {
        throw new Error("Nested browser-sequence commands are not supported.");
      }
      return executeSequenceCommand(command);
    case "click-point":
      return interactionExecuteClickPointCommand(command);
    case "fill":
      return interactionExecuteFillCommand(command);
    case "key":
      return interactionExecuteKeyCommand(command);
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
    case "measure":
      return executeMeasureCommand(command);
    default:
      throw new Error(`Unsupported Agent Picker browser command: ${String(command?.type)}`);
  }
}

async function executeBrowserCommand(command) {
  return executeBrowserCommandInternal(command, { allowSequence: true });
}

globalThis.AgentPickerExtensionAgentActions = { executeBrowserCommand };
})();
