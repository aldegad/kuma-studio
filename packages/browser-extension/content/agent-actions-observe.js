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
} = globalThis.KumaPickerExtensionAgentActionCore;
var {
  waitForDelay: interactionWaitForDelay,
  executeClickCommand: interactionExecuteClickCommand,
  executeClickPointCommand: interactionExecuteClickPointCommand,
  executeFillCommand: interactionExecuteFillCommand,
  executeInsertTextCommand: interactionExecuteInsertTextCommand,
  executeKeyCommand: interactionExecuteKeyCommand,
  executeKeyDownCommand: interactionExecuteKeyDownCommand,
  executeKeyUpCommand: interactionExecuteKeyUpCommand,
  executeMouseMoveCommand: interactionExecuteMouseMoveCommand,
  executeMouseDownCommand: interactionExecuteMouseDownCommand,
  executeMouseUpCommand: interactionExecuteMouseUpCommand,
  executePointerDragCommand: interactionExecutePointerDragCommand,
} = globalThis.KumaPickerExtensionAgentActionInteraction;
var {
  createObserveExtras,
} = globalThis.KumaPickerExtensionAgentActionObserveExtra;

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

let executeBrowserCommandInternal = null;
const observeExtras = createObserveExtras({
  normalizeText: coreNormalizeText,
  normalizeRole: coreNormalizeRole,
  isExtensionUiElement: coreIsExtensionUiElement,
  isVisibleElement: coreIsVisibleElement,
  describeElementForCommand: coreDescribeElementForCommand,
  getFillableElements: coreGetFillableElements,
  findBestFillableByLabel: coreFindBestFillableByLabel,
  getScopeRoot: coreGetScopeRoot,
  findElementByTextWithinRoot: coreFindElementByTextWithinRoot,
  findElementBySelectorWithinRoot: coreFindElementBySelectorWithinRoot,
  getAccessibleText: coreGetAccessibleText,
  scoreTextMatch: coreScoreTextMatch,
  buildPageRecord,
  createSelector,
  createSelectorPath,
  runNestedCommand(command) {
    return executeBrowserCommandInternal(command, { allowSequence: false });
  },
});

executeBrowserCommandInternal = async function executeBrowserCommandInternal(command, options = {}) {
  const allowSequence = options.allowSequence !== false;
  switch (command?.type) {
    case "context":
      return { pageContext: buildPageContext(getPageTargetElement()) };
    case "dom":
      return { domSnapshot: coreBuildDomSnapshot() };
    case "console":
      return {
        page: buildPageRecord(),
        ...(globalThis.KumaPickerExtensionRuntimeObserver?.readEntries?.() ?? {
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
      return observeExtras.executeSequenceCommand(command);
    case "click-point":
      return interactionExecuteClickPointCommand(command);
    case "fill":
      return interactionExecuteFillCommand(command);
    case "insert-text":
      return interactionExecuteInsertTextCommand(command);
    case "key":
      return interactionExecuteKeyCommand(command);
    case "keydown":
      return interactionExecuteKeyDownCommand(command);
    case "keyup":
      return interactionExecuteKeyUpCommand(command);
    case "mousemove":
      return interactionExecuteMouseMoveCommand(command);
    case "mousedown":
      return interactionExecuteMouseDownCommand(command);
    case "mouseup":
      return interactionExecuteMouseUpCommand(command);
    case "pointer-drag":
      return interactionExecutePointerDragCommand(command);
    case "wait-for-text":
      return executeWaitForTextCommand(command, true);
    case "wait-for-text-disappear":
      return executeWaitForTextCommand(command, false);
    case "wait-for-selector":
      return executeWaitForSelectorCommand(command);
    case "wait-for-dialog-close":
      return executeWaitForDialogCloseCommand(command);
    case "query-dom":
      return observeExtras.executeQueryDomCommand(command);
    case "measure":
      return observeExtras.executeMeasureCommand(command);
    default:
      throw new Error(`Unsupported Kuma Picker browser command: ${String(command?.type)}`);
  }
};

async function executeBrowserCommand(command) {
  return executeBrowserCommandInternal(command, { allowSequence: true });
}

globalThis.KumaPickerExtensionAgentActions = { executeBrowserCommand };
})();
