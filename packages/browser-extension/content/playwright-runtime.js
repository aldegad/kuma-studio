(() => {
const core = globalThis.KumaPickerExtensionAgentActionCore;
const interaction = globalThis.KumaPickerExtensionAgentActionInteraction;

if (!core || !interaction) {
  throw new Error("Kuma Picker automation runtime failed to initialize.");
}

const {
  normalizeText,
  isVisibleElement,
  describeElementForCommand,
  getAccessibleText,
  getFillableElements,
  getCommandCandidatesWithinRoot,
  matchesRequestedRole,
} = core;
const {
  waitForDelay,
  executeClickCommand,
  executeFillCommand,
  executeKeyCommand,
  executeKeyDownCommand,
  executeKeyUpCommand,
  executeMouseMoveCommand,
  executeMouseDownCommand,
  executeMouseUpCommand,
  executePointerDragCommand,
} = interaction;

function getRoot() {
  return document.body || document.documentElement;
}

function toLocatorCommand(locator) {
  if (!locator || typeof locator !== "object") {
    throw new Error("A locator payload is required.");
  }

  switch (locator.kind) {
    case "selector":
      return {
        selector: typeof locator.selector === "string" ? locator.selector : null,
      };
    case "text":
      return {
        text: typeof locator.text === "string" ? locator.text : null,
        exactText: locator.exact === true,
      };
    case "role":
      return {
        role: typeof locator.role === "string" ? locator.role : null,
        text: typeof locator.name === "string" ? locator.name : null,
        exactText: locator.exact === true,
      };
    case "label":
      return {
        label: typeof locator.text === "string" ? locator.text : null,
      };
    default:
      throw new Error(`Unsupported locator kind: ${String(locator.kind)}`);
  }
}

function scoreText(candidate, expected, exact) {
  if (!candidate || !expected) {
    return 0;
  }

  if (exact) {
    return candidate === expected ? 3 : 0;
  }

  if (candidate === expected) {
    return 3;
  }
  if (candidate.startsWith(expected)) {
    return 2;
  }
  if (candidate.includes(expected)) {
    return 1;
  }
  return 0;
}

function resolveSelectorElement(locator, { allowHidden = false } = {}) {
  const selector = typeof locator?.selector === "string" ? locator.selector.trim() : "";
  if (!selector) {
    throw new Error("The selector locator requires a non-empty selector.");
  }

  const target = document.querySelector(selector);
  if (!(target instanceof Element)) {
    return null;
  }

  if (!allowHidden && !isVisibleElement(target)) {
    return null;
  }

  return target;
}

function resolveTextOrRoleElement(locator, { allowHidden = false } = {}) {
  const candidates = getCommandCandidatesWithinRoot(getRoot());
  const expectedText = typeof locator?.text === "string" ? normalizeText(locator.text) : "";
  const exact = locator?.exact === true;

  const ranked = candidates
    .filter((candidate) => allowHidden || isVisibleElement(candidate))
    .filter((candidate) =>
      locator.kind === "role" ? matchesRequestedRole(candidate, locator.role) : true,
    )
    .map((candidate) => ({
      element: candidate,
      score: expectedText ? scoreText(getAccessibleText(candidate), expectedText, exact) : 1,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.element ?? null;
}

function resolveLabelElement(locator, { allowHidden = false } = {}) {
  const expected = typeof locator?.text === "string" ? normalizeText(locator.text) : "";
  const exact = locator?.exact === true;
  if (!expected) {
    throw new Error("The label locator requires a non-empty label.");
  }

  const ranked = getFillableElements(getRoot())
    .filter((candidate) => allowHidden || isVisibleElement(candidate))
    .map((candidate) => {
      const label = normalizeText(describeElementForCommand(candidate).label);
      return {
        element: candidate,
        score: scoreText(label, expected, exact),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.element ?? null;
}

function resolveLocatorElement(locator, options = {}) {
  switch (locator?.kind) {
    case "selector":
      return resolveSelectorElement(locator, options);
    case "text":
    case "role":
      return resolveTextOrRoleElement(locator, options);
    case "label":
      return resolveLabelElement(locator, options);
    default:
      throw new Error(`Unsupported locator kind: ${String(locator?.kind)}`);
  }
}

function buildLocatorSelectorPath(target) {
  return describeElementForCommand(target).selectorPath;
}

function readInputValue(target) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value;
  }

  if (target instanceof HTMLSelectElement) {
    return target.value;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return target.innerText || target.textContent || "";
  }

  return null;
}

function serializeValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value ?? null;
  }

  if (typeof value === "bigint") {
    return { kind: "bigint", value: String(value) };
  }

  if (typeof value === "undefined") {
    return { kind: "undefined" };
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
    return value.slice(0, 50).map((entry) => serializeValue(entry, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return { kind: "circular" };
    }

    seen.add(value);
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, entry]) => [key, serializeValue(entry, depth + 1, seen)]),
    );
  }

  return String(value);
}

function readWaitState(target, state) {
  const present = target instanceof Element;
  const visible = present && isVisibleElement(target);

  switch (state) {
    case "attached":
      return present;
    case "detached":
      return !present;
    case "hidden":
      return !present || !visible;
    case "visible":
    default:
      return visible;
  }
}

async function pollUntil(timeoutMs, evaluator, failureMessage) {
  const startedAt = Date.now();
  const pollIntervalMs = document.visibilityState === "visible" ? 34 : 100;

  while (Date.now() - startedAt <= timeoutMs) {
    const result = evaluator();
    if (result.matched) {
      return result.value;
    }
    await waitForDelay(pollIntervalMs);
  }

  throw new Error(failureMessage);
}

async function executePageTitle() {
  return {
    page: buildPageRecord(),
    title: document.title,
  };
}

async function executePageEvaluate(command) {
  const pageRecord = buildPageRecord();
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

  if (command?.kind === "function") {
    const evaluator = new AsyncFunction(
      "window",
      "document",
      "globalThis",
      "page",
      "arg",
      `return (${command.source})(arg);`,
    );
    const value = await evaluator(window, document, globalThis, pageRecord, command.arg ?? null);
    return {
      page: pageRecord,
      value: serializeValue(value),
    };
  }

  if (command?.kind === "expression") {
    let evaluator;
    try {
      evaluator = new AsyncFunction(
        "window",
        "document",
        "globalThis",
        "page",
        "arg",
        `return (${command.source});`,
      );
    } catch {
      evaluator = new AsyncFunction(
        "window",
        "document",
        "globalThis",
        "page",
        "arg",
        command.source,
      );
    }
    const value = await evaluator(window, document, globalThis, pageRecord, command.arg ?? null);
    return {
      page: pageRecord,
      value: serializeValue(value),
    };
  }

  throw new Error("Unsupported evaluate payload.");
}

async function executePageWaitForSelector(command) {
  const selector = typeof command?.selector === "string" ? command.selector.trim() : "";
  if (!selector) {
    throw new Error("page.waitForSelector requires a non-empty selector.");
  }

  const timeoutMs =
    typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) ? command.timeoutMs : 15_000;
  const state = typeof command?.state === "string" ? command.state : "visible";
  const target = await pollUntil(
    timeoutMs,
    () => {
      const current = document.querySelector(selector);
      return {
        matched: readWaitState(current, state),
        value: current,
      };
    },
    `Timed out waiting for selector "${selector}" to reach state "${state}".`,
  );

  return {
    page: buildPageRecord(),
    selector,
    state,
    element: target instanceof Element ? describeElementForCommand(target) : null,
  };
}

async function executeLocatorClick(command) {
  const locatorCommand = toLocatorCommand(command.locator);
  return executeClickCommand(locatorCommand);
}

async function executeLocatorFill(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve a fillable locator target.");
  }

  return executeFillCommand({
    selectorPath: buildLocatorSelectorPath(target),
    value: String(command.value ?? ""),
  });
}

async function executeLocatorPress(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve a locator target for key input.");
  }

  return executeKeyCommand({
    selectorPath: buildLocatorSelectorPath(target),
    key: command.key,
    holdMs: command.holdMs,
    shiftKey: command.shiftKey === true,
    altKey: command.altKey === true,
    ctrlKey: command.ctrlKey === true,
    metaKey: command.metaKey === true,
  });
}

async function executeLocatorTextContent(command) {
  const target = resolveLocatorElement(command.locator, { allowHidden: true });
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target.");
  }

  return {
    page: buildPageRecord(),
    textContent: target.textContent ?? null,
  };
}

async function executeLocatorInputValue(command) {
  const target = resolveLocatorElement(command.locator, { allowHidden: true });
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target.");
  }

  return {
    page: buildPageRecord(),
    inputValue: readInputValue(target),
  };
}

async function executeLocatorIsVisible(command) {
  const target = resolveLocatorElement(command.locator, { allowHidden: true });
  return {
    page: buildPageRecord(),
    visible: target instanceof Element ? isVisibleElement(target) : false,
  };
}

async function executeLocatorWaitFor(command) {
  const timeoutMs =
    typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) ? command.timeoutMs : 15_000;
  const state = typeof command?.state === "string" ? command.state : "visible";
  const target = await pollUntil(
    timeoutMs,
    () => {
      const current = resolveLocatorElement(command.locator, {
        allowHidden: state !== "visible",
      });
      return {
        matched: readWaitState(current, state),
        value: current,
      };
    },
    `Timed out waiting for the locator to reach state "${state}".`,
  );

  return {
    page: buildPageRecord(),
    state,
    element: target instanceof Element ? describeElementForCommand(target) : null,
  };
}

async function executeLocatorMeasure(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target.");
  }

  return {
    page: buildPageRecord(),
    element: describeElementForCommand(target),
    rect: target.getBoundingClientRect(),
  };
}

async function executeKeyboardPress(command) {
  return executeKeyCommand({
    key: command.key,
    holdMs: command.holdMs,
    shiftKey: command.shiftKey === true,
    altKey: command.altKey === true,
    ctrlKey: command.ctrlKey === true,
    metaKey: command.metaKey === true,
  });
}

async function executeKeyboardDown(command) {
  return executeKeyDownCommand({
    key: command.key,
    shiftKey: command.shiftKey === true,
    altKey: command.altKey === true,
    ctrlKey: command.ctrlKey === true,
    metaKey: command.metaKey === true,
  });
}

async function executeKeyboardUp(command) {
  return executeKeyUpCommand({
    key: command.key,
    shiftKey: command.shiftKey === true,
    altKey: command.altKey === true,
    ctrlKey: command.ctrlKey === true,
    metaKey: command.metaKey === true,
  });
}

async function executeMouseMove(command) {
  return executeMouseMoveCommand({
    x: command.x,
    y: command.y,
  });
}

async function executeMouseDown(command) {
  return executeMouseDownCommand({
    x: command.x,
    y: command.y,
    button: command.button,
  });
}

async function executeMouseUp(command) {
  return executeMouseUpCommand({
    x: command.x,
    y: command.y,
    button: command.button,
  });
}

async function executeMouseDrag(command) {
  return executePointerDragCommand({
    from: command.from,
    to: command.to,
    durationMs: command.durationMs,
    steps: command.steps,
  });
}

async function executeAutomationCommand(command) {
  let normalizedCommand = command;
  while (
    normalizedCommand?.command &&
    typeof normalizedCommand.command === "object" &&
    !Array.isArray(normalizedCommand.command)
  ) {
    normalizedCommand = normalizedCommand.command;
  }

  if (normalizedCommand?.type !== "playwright") {
    throw new Error(`Unsupported automation payload: ${String(normalizedCommand?.type)}`);
  }

  switch (normalizedCommand.action) {
    case "page.title":
      return executePageTitle();
    case "page.evaluate":
      return executePageEvaluate(normalizedCommand);
    case "page.waitForSelector":
      return executePageWaitForSelector(normalizedCommand);
    case "locator.click":
      return executeLocatorClick(normalizedCommand);
    case "locator.fill":
      return executeLocatorFill(normalizedCommand);
    case "locator.press":
      return executeLocatorPress(normalizedCommand);
    case "locator.textContent":
      return executeLocatorTextContent(normalizedCommand);
    case "locator.inputValue":
      return executeLocatorInputValue(normalizedCommand);
    case "locator.isVisible":
      return executeLocatorIsVisible(normalizedCommand);
    case "locator.waitFor":
      return executeLocatorWaitFor(normalizedCommand);
    case "locator.measure":
      return executeLocatorMeasure(normalizedCommand);
    case "keyboard.press":
      return executeKeyboardPress(normalizedCommand);
    case "keyboard.down":
      return executeKeyboardDown(normalizedCommand);
    case "keyboard.up":
      return executeKeyboardUp(normalizedCommand);
    case "mouse.move":
      return executeMouseMove(normalizedCommand);
    case "mouse.down":
      return executeMouseDown(normalizedCommand);
    case "mouse.up":
      return executeMouseUp(normalizedCommand);
    case "mouse.drag":
      return executeMouseDrag(normalizedCommand);
    default:
      throw new Error(`Unsupported Kuma Playwright action: ${String(normalizedCommand.action)}`);
  }
}

globalThis.KumaPickerExtensionPlaywrightRuntime = {
  executeAutomationCommand,
};
})();
