(() => {
var KumaPickerExtensionAgentActionObserveExtra = (() => {
  function createObserveExtras(deps) {
    const {
      normalizeText,
      normalizeRole,
      isExtensionUiElement,
      isVisibleElement,
      describeElementForCommand,
      getFillableElements,
      findBestFillableByLabel,
      getScopeRoot,
      findElementByTextWithinRoot,
      getAccessibleText,
      scoreTextMatch,
      buildPageRecord,
      createSelector,
      createSelectorPath,
      runNestedCommand,
    } = deps;

    function executeMeasureCommand(command) {
      const selector = command?.selectorPath || command?.selector;
      if (!selector) {
        throw new Error("The measure command requires --selector or --selector-path.");
      }

      const scopeRoot = getScopeRoot(command?.scope);
      if (!scopeRoot) {
        throw new Error("No visible dialog is open for the requested dialog scope.");
      }

      const target = deps.findElementBySelectorWithinRoot(selector, scopeRoot);
      if (!(target instanceof Element)) {
        throw new Error(`Failed to find an element that matches ${selector}.`);
      }

      return {
        page: buildPageRecord(),
        scope: command?.scope === "dialog" ? "dialog" : "page",
        selector,
        element: describeElementForCommand(target),
        rect: target.getBoundingClientRect(),
      };
    }

    function serializeQueryResult(element) {
      const record = describeElementForCommand(element);
      const textContent = normalizeText(element.textContent).slice(0, 400) || null;
      const displayValue =
        element instanceof HTMLSelectElement
          ? normalizeText(Array.from(element.selectedOptions).map((option) => option.textContent).join(" ")) || null
          : record.inputType === "contenteditable"
            ? record.value ?? null
            : record.valuePreview ?? record.value ?? null;

      return {
        label: record.label,
        tagName: record.tagName,
        role: record.role,
        selector: record.selector,
        selectorPath: record.selectorPath,
        focused: document.activeElement === element,
        value: record.value,
        displayValue,
        valuePreview: record.valuePreview,
        selectionStart: record.selectionStart,
        selectionEnd: record.selectionEnd,
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

    function serializeEvalValue(value, depth = 0, seen = new WeakSet()) {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value ?? null;
      }

      if (typeof value === "bigint") {
        return { kind: "bigint", value: String(value) };
      }

      if (typeof value === "undefined") {
        return { kind: "undefined" };
      }

      if (typeof value === "symbol") {
        return { kind: "symbol", value: String(value) };
      }

      if (typeof value === "function") {
        return { kind: "function", name: value.name || null };
      }

      if (depth >= 4) {
        return { kind: "max-depth" };
      }

      if (value instanceof Element) {
        return {
          kind: "element",
          element: describeElementForCommand(value),
        };
      }

      if (value instanceof Error) {
        return {
          kind: "error",
          name: value.name,
          message: value.message,
        };
      }

      if (value instanceof Date) {
        return {
          kind: "date",
          value: value.toISOString(),
        };
      }

      if (Array.isArray(value)) {
        return value.slice(0, 50).map((entry) => serializeEvalValue(entry, depth + 1, seen));
      }

      if (typeof value === "object") {
        if (seen.has(value)) {
          return { kind: "circular" };
        }

        seen.add(value);
        const entries = Object.entries(value).slice(0, 50);
        return Object.fromEntries(entries.map(([key, entry]) => [key, serializeEvalValue(entry, depth + 1, seen)]));
      }

      return String(value);
    }

    async function executeEvalCommand(command) {
      const expressionCandidate =
        typeof command?.expression === "string"
          ? command.expression
          : typeof command?.text === "string"
            ? command.text
            : typeof command?.value === "string"
              ? command.value
              : "";
      const expression = expressionCandidate.trim();
      if (!expression) {
        throw new Error("browser-eval requires --expression.");
      }

      const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;
      let evaluator;

      try {
        evaluator = new AsyncFunction("window", "document", "globalThis", "page", `return (${expression});`);
      } catch {
        evaluator = new AsyncFunction("window", "document", "globalThis", "page", expression);
      }

      const value = await evaluator(window, document, globalThis, buildPageRecord());

      return {
        page: buildPageRecord(),
        expression,
        value: serializeEvalValue(value),
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

    function querySelectorState(scope, command) {
      const selector = normalizeText(command?.selectorPath) || normalizeText(command?.selector);
      if (!selector) {
        throw new Error("browser-query-dom --kind selector-state requires --selector or --selector-path.");
      }

      const root = getQueryableRoot(scope);
      const target = deps.findElementBySelectorWithinRoot(selector, root);
      if (!(target instanceof Element)) {
        throw new Error(`Failed to find an element that matches ${selector}.`);
      }

      return { selector, elements: [target] };
    }

    function executeQueryDomCommand(command) {
      const kind = normalizeText(command?.kind).toLowerCase();
      const text = normalizeText(command?.text);
      const scope = command?.scope === "dialog" ? "dialog" : "page";
      const selectorState = kind === "selector-state" ? querySelectorState(scope, command) : null;

      const queryMap = {
        "required-fields": { elements: queryRequiredFields(scope), serializer: serializeQueryResult },
        "all-textareas": { elements: queryAllTextareas(scope), serializer: serializeQueryResult },
        "nearby-input": { elements: text ? queryNearbyInput(scope, text) : null, serializer: serializeQueryResult, requiresText: true },
        "input-by-label": { elements: text ? queryInputByLabel(scope, text) : null, serializer: serializeQueryResult, requiresText: true },
        "selector-state": {
          elements: selectorState?.elements ?? null,
          serializer: serializeQueryResult,
        },
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
        selector: selectorState?.selector ?? null,
        count: definition.elements.length,
        results: definition.elements.map(definition.serializer),
      };
    }

    const SEQUENCE_STEP_TYPES = new Set([
      "click",
      "click-point",
      "pointer-drag",
      "fill",
      "insert-text",
      "key",
      "keydown",
      "keyup",
      "mousemove",
      "mousedown",
      "mouseup",
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
      "selector-state",
    ]);
    let nextSequenceRunId = 1;
    let activeSequenceRunner = null;
    let lastSequenceRunner = null;

    function createSequenceStopError() {
      const error = new Error("Sequence stopped.");
      error.sequenceStopped = true;
      return error;
    }

    function createSequenceRunId() {
      return `sequence-run-${Date.now()}-${nextSequenceRunId++}`;
    }

    function buildSequenceRunnerSnapshot(runner) {
      if (!runner) {
        return {
          active: false,
          runId: null,
          status: "idle",
          stepCount: 0,
          completedStepCount: 0,
          startedAt: null,
          finishedAt: null,
          currentStepIndex: null,
          currentStepType: null,
          currentStepLabel: null,
          error: null,
        };
      }

      return {
        active: runner.status === "running" || runner.status === "stopping",
        runId: runner.runId,
        status: runner.status,
        stepCount: runner.stepCount,
        completedStepCount: runner.completedStepCount,
        startedAt: runner.startedAt,
        finishedAt: runner.finishedAt ?? null,
        currentStepIndex: runner.currentStepIndex ?? null,
        currentStepType: runner.currentStepType ?? null,
        currentStepLabel: runner.currentStepLabel ?? null,
        error: runner.error ?? null,
      };
    }

    function ensureSequenceNotStopped(runner) {
      if (runner?.stopRequested === true) {
        throw createSequenceStopError();
      }
    }

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

    function assertSelectorState(assertion, actual, stepIndex, assertionIndex) {
      const expectedEntries = Object.entries({
        value: assertion?.value,
        focused: typeof assertion?.focused === "boolean" ? assertion.focused : undefined,
        selectionStart:
          typeof assertion?.selectionStart === "number" && Number.isFinite(assertion.selectionStart)
            ? assertion.selectionStart
            : undefined,
        selectionEnd:
          typeof assertion?.selectionEnd === "number" && Number.isFinite(assertion.selectionEnd)
            ? assertion.selectionEnd
            : undefined,
        textContent: typeof assertion?.textContent === "string" ? assertion.textContent : undefined,
        visible: typeof assertion?.visible === "boolean" ? assertion.visible : undefined,
      }).filter(([, value]) => value !== undefined);

      for (const [field, expectedValue] of expectedEntries) {
        if (actual?.[field] !== expectedValue) {
          throw new Error(
            `Sequence step ${stepIndex + 1} assertion ${assertionIndex + 1} (selector-state) expected ${field}=${JSON.stringify(expectedValue)} but got ${JSON.stringify(actual?.[field] ?? null)}.`,
          );
        }
      }
    }

    async function executeSequenceAssertions(assertions, stepIndex, runner = null) {
      const results = [];

      for (let assertionIndex = 0; assertionIndex < assertions.length; assertionIndex += 1) {
        ensureSequenceNotStopped(runner);
        const assertion = assertions[assertionIndex];
        const type = normalizeText(assertion?.type).toLowerCase();
        if (!SEQUENCE_ASSERTION_TYPES.has(type)) {
          throw new Error(
            `Sequence step ${stepIndex + 1} assertion ${assertionIndex + 1} uses unsupported type "${String(assertion?.type)}".`,
          );
        }

        try {
          let result;
          if (type === "selector-state") {
            const selectorResult = executeQueryDomCommand({
              ...assertion,
              type: "query-dom",
              kind: "selector-state",
            });
            const actual = Array.isArray(selectorResult?.results) ? selectorResult.results[0] ?? null : null;
            assertSelectorState(assertion, actual, stepIndex, assertionIndex);
            result = selectorResult;
          } else {
            result = await runNestedCommand({ ...assertion, type });
          }
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

    async function runSequenceSteps(command, runner = null) {
      const steps = normalizeSequenceSteps(command);
      const completedSteps = [];

      for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
        ensureSequenceNotStopped(runner);
        const step = steps[stepIndex];
        if (!step || typeof step !== "object" || Array.isArray(step)) {
          throw new Error(`Sequence step ${stepIndex + 1} must be an object.`);
        }

        const type = normalizeText(step?.type).toLowerCase();
        if (!SEQUENCE_STEP_TYPES.has(type)) {
          throw new Error(`Sequence step ${stepIndex + 1} uses unsupported type "${String(step?.type)}".`);
        }

        const { assertions, ...stepCommand } = step;
        if (runner) {
          runner.currentStepIndex = stepIndex + 1;
          runner.currentStepType = type;
          runner.currentStepLabel = typeof step.label === "string" && step.label.trim() ? step.label.trim() : null;
        }

        try {
          const result = await runNestedCommand({ ...stepCommand, type });
          ensureSequenceNotStopped(runner);
          completedSteps.push({
            index: stepIndex + 1,
            type,
            label: typeof step.label === "string" && step.label.trim() ? step.label.trim() : null,
            result,
            assertions: await executeSequenceAssertions(normalizeSequenceAssertions(step), stepIndex, runner),
          });
          if (runner) {
            runner.completedStepCount = completedSteps.length;
          }
        } catch (error) {
          throw new Error(`Sequence step ${stepIndex + 1} (${type}) failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return completedSteps;
    }

    async function executeSequenceCommand(command) {
      const completedSteps = await runSequenceSteps(command, null);

      return {
        page: buildPageRecord(),
        stepCount: completedSteps.length,
        steps: completedSteps,
      };
    }

    function readSequenceStateCommand() {
      return {
        page: buildPageRecord(),
        sequence: buildSequenceRunnerSnapshot(activeSequenceRunner ?? lastSequenceRunner),
      };
    }

    function stopSequenceCommand(command) {
      const runId = typeof command?.runId === "string" && command.runId.trim() ? command.runId.trim() : null;
      const runner = activeSequenceRunner;

      if (!runner) {
        return {
          page: buildPageRecord(),
          sequence: buildSequenceRunnerSnapshot(lastSequenceRunner),
          stopRequested: false,
        };
      }

      if (runId && runner.runId !== runId) {
        return {
          page: buildPageRecord(),
          sequence: buildSequenceRunnerSnapshot(runner),
          stopRequested: false,
        };
      }

      runner.stopRequested = true;
      runner.status = "stopping";
      return {
        page: buildPageRecord(),
        sequence: buildSequenceRunnerSnapshot(runner),
        stopRequested: true,
      };
    }

    function startSequenceCommand(command) {
      if (activeSequenceRunner && (activeSequenceRunner.status === "running" || activeSequenceRunner.status === "stopping")) {
        throw new Error("A browser sequence is already running on this page.");
      }

      const steps = normalizeSequenceSteps(command);
      const runner = {
        runId: createSequenceRunId(),
        status: "running",
        stepCount: steps.length,
        completedStepCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        currentStepIndex: null,
        currentStepType: null,
        currentStepLabel: null,
        error: null,
        stopRequested: false,
      };

      activeSequenceRunner = runner;
      lastSequenceRunner = runner;

      void (async () => {
        try {
          await runSequenceSteps(command, runner);
          runner.status = runner.stopRequested ? "stopped" : "completed";
        } catch (error) {
          if (error?.sequenceStopped === true || runner.stopRequested) {
            runner.status = "stopped";
            runner.error = null;
          } else {
            runner.status = "failed";
            runner.error = error instanceof Error ? error.message : String(error);
          }
        } finally {
          runner.finishedAt = new Date().toISOString();
          runner.currentStepIndex = null;
          runner.currentStepType = null;
          runner.currentStepLabel = null;
          lastSequenceRunner = { ...runner };
          if (activeSequenceRunner?.runId === runner.runId) {
            activeSequenceRunner = null;
          }
        }
      })();

      return {
        page: buildPageRecord(),
        sequence: buildSequenceRunnerSnapshot(runner),
      };
    }

    return {
      executeEvalCommand,
      executeMeasureCommand,
      executeQueryDomCommand,
      executeSequenceCommand,
      readSequenceStateCommand,
      startSequenceCommand,
      stopSequenceCommand,
    };
  }

  return { createObserveExtras };
})();

globalThis.KumaPickerExtensionAgentActionObserveExtra = KumaPickerExtensionAgentActionObserveExtra;
})();
