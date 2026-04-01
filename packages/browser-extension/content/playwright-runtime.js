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
  executeClickPointCommand,
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

function resolveLocatorMatch(matches, locator, description) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return null;
  }

  if (locator?.nth === "last") {
    return matches.at(-1) ?? null;
  }

  if (locator?.nth == null) {
    return matches[0] ?? null;
  }

  if (!Number.isInteger(locator.nth) || locator.nth < 0) {
    throw new Error(`${description} requires a non-negative integer nth index.`);
  }

  return matches[locator.nth] ?? null;
}

function resolveChainedSelector(selectorString, root, allowHidden) {
  const segments = selectorString.split(">>").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    return [];
  }

  let currentElements = [root];

  for (const segment of segments) {
    const textMatch = segment.match(/^text=["']?(.+?)["']?$/i);
    const nextElements = [];

    for (const parent of currentElements) {
      if (textMatch) {
        const expectedText = normalizeText(textMatch[1]);
        const walker = document.createTreeWalker(parent, NodeFilter.SHOW_ELEMENT, null);
        let node = walker.nextNode();
        while (node) {
          if (node instanceof Element) {
            const nodeText = normalizeText(node.textContent || "");
            if (nodeText.includes(expectedText) && (allowHidden || isVisibleElement(node))) {
              nextElements.push(node);
            }
          }
          node = walker.nextNode();
        }
      } else {
        try {
          const found = Array.from(parent.querySelectorAll(segment)).filter(
            (el) => el instanceof Element && (allowHidden || isVisibleElement(el)),
          );
          nextElements.push(...found);
        } catch {
          throw new Error(`Invalid CSS selector segment: "${segment}"`);
        }
      }
    }

    if (nextElements.length === 0) {
      return [];
    }
    currentElements = nextElements;
  }

  return currentElements;
}

function resolveSelectorMatches(selector, root, { allowHidden = false } = {}) {
  if (typeof selector !== "string" || !selector.trim()) {
    return [];
  }

  if (selector.includes(">>")) {
    return resolveChainedSelector(selector, root, allowHidden);
  }

  return Array.from(root.querySelectorAll(selector)).filter(
    (candidate) => candidate instanceof Element && (allowHidden || isVisibleElement(candidate)),
  );
}

function resolveSelectorTarget(selector, root, options) {
  return resolveSelectorMatches(selector, root, options)[0] ?? null;
}

function resolveSelectorElement(locator, { allowHidden = false } = {}) {
  const selector = typeof locator?.selector === "string" ? locator.selector.trim() : "";
  if (!selector) {
    throw new Error("The selector locator requires a non-empty selector.");
  }

  const root = locator?._iframeContext ?? document;
  const matches = resolveSelectorMatches(selector, root, { allowHidden });

  return resolveLocatorMatch(matches, locator, "The selector locator");
}

function resolveTextOrRoleElement(locator, { allowHidden = false } = {}) {
  const root = locator?._iframeContext ? locator._iframeContext.body || locator._iframeContext.documentElement : getRoot();
  const candidates = getCommandCandidatesWithinRoot(root);
  const expectedText =
    locator?.kind === "role"
      ? typeof locator?.name === "string"
        ? normalizeText(locator.name)
        : ""
      : typeof locator?.text === "string"
        ? normalizeText(locator.text)
        : "";
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

  return resolveLocatorMatch(
    ranked.map((entry) => entry.element),
    locator,
    `The ${locator?.kind === "role" ? "role" : "text"} locator`,
  );
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

  return resolveLocatorMatch(ranked.map((entry) => entry.element), locator, "The label locator");
}

function resolvePlaceholderElement(locator, { allowHidden = false } = {}) {
  const expected = typeof locator?.text === "string" ? normalizeText(locator.text) : "";
  const exact = locator?.exact === true;
  if (!expected) {
    throw new Error("The placeholder locator requires a non-empty placeholder.");
  }

  const candidates = Array.from(document.querySelectorAll("input[placeholder], textarea[placeholder]"))
    .filter((candidate) => candidate instanceof Element && (allowHidden || isVisibleElement(candidate)));

  const ranked = candidates
    .map((candidate) => {
      const placeholder = normalizeText(candidate.getAttribute("placeholder"));
      return {
        element: candidate,
        score: scoreText(placeholder, expected, exact),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return resolveLocatorMatch(ranked.map((entry) => entry.element), locator, "The placeholder locator");
}

function resolveTestIdElement(locator, { allowHidden = false } = {}) {
  const testId = typeof locator?.testId === "string" ? locator.testId.trim() : "";
  if (!testId) {
    throw new Error("The testid locator requires a non-empty test ID.");
  }

  const selectors = [
    `[data-testid="${CSS.escape(testId)}"]`,
    `[data-test-id="${CSS.escape(testId)}"]`,
    `[data-test="${CSS.escape(testId)}"]`,
  ];

  const matches = [];
  for (const selector of selectors) {
    try {
      const elements = Array.from(document.querySelectorAll(selector))
        .filter((candidate) => candidate instanceof Element && (allowHidden || isVisibleElement(candidate)));
      matches.push(...elements);
    } catch {}
  }

  const unique = [...new Set(matches)];
  return resolveLocatorMatch(unique, locator, "The testid locator");
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
    case "placeholder":
      return resolvePlaceholderElement(locator, options);
    case "testid":
      return resolveTestIdElement(locator, options);
    default:
      throw new Error(`Unsupported locator kind: ${String(locator?.kind)}`);
  }
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
      executionWorld: "content-script",
      evaluateBackend: "content-script",
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
      executionWorld: "content-script",
      evaluateBackend: "content-script",
    };
  }

  throw new Error("Unsupported evaluate payload.");
}

function waitForSelectorWithObserver(selector, state, timeoutMs) {
  return new Promise((resolve, reject) => {
    const findTarget = () => resolveSelectorTarget(selector, document, { allowHidden: true });

    const check = () => {
      const current = findTarget();
      if (readWaitState(current, state)) {
        return current;
      }
      return null;
    };

    const immediate = check();
    if (immediate !== null || (state === "detached" && !findTarget())) {
      resolve(immediate);
      return;
    }

    let observer = null;
    let timer = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    observer = new MutationObserver(() => {
      const result = check();
      if (result !== null || (state === "detached" && !findTarget())) {
        cleanup();
        resolve(result);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden"],
    });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for selector "${selector}" to reach state "${state}".`));
    }, timeoutMs);
  });
}

async function executePageWaitForSelector(command) {
  const selector = typeof command?.selector === "string" ? command.selector.trim() : "";
  if (!selector) {
    throw new Error("page.waitForSelector requires a non-empty selector.");
  }

  const timeoutMs =
    typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) ? command.timeoutMs : 30_000;
  const state = typeof command?.state === "string" ? command.state : "visible";
  const target = await waitForSelectorWithObserver(selector, state, timeoutMs);

  return {
    page: buildPageRecord(),
    selector,
    state,
    element: target instanceof Element ? describeElementForCommand(target) : null,
  };
}

async function executeLocatorClick(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target.");
  }

  return executeClickCommand({
    targetElement: target,
  });
}

async function executeLocatorFill(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve a fillable locator target.");
  }

  return executeFillCommand({
    targetElement: target,
    value: String(command.value ?? ""),
  });
}

async function executeLocatorPress(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve a locator target for key input.");
  }

  return executeKeyCommand({
    targetElement: target,
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

async function executeMouseClick(command) {
  return executeClickPointCommand({
    x: command.x,
    y: command.y,
    postActionDelayMs: command.postActionDelayMs,
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


async function executeLocatorHover(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target for hover.");
  }

  return interaction.executeHoverCommand({
    targetElement: target,
  });
}

async function executeLocatorDblClick(command) {
  const target = resolveLocatorElement(command.locator);
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target for double-click.");
  }

  return interaction.executeDblClickCommand({
    targetElement: target,
  });
}

async function executeLocatorGetAttribute(command) {
  const target = resolveLocatorElement(command.locator, { allowHidden: true });
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target.");
  }

  const name = typeof command?.name === "string" ? command.name : "";
  if (!name) {
    throw new Error("locator.getAttribute requires an attribute name.");
  }

  return {
    page: buildPageRecord(),
    attributeValue: target.getAttribute(name),
  };
}

async function executeLocatorInnerText(command) {
  const target = resolveLocatorElement(command.locator, { allowHidden: true });
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target.");
  }

  return {
    page: buildPageRecord(),
    innerText: target instanceof HTMLElement ? target.innerText : (target.textContent ?? null),
  };
}

async function executeLocatorInnerHTML(command) {
  const target = resolveLocatorElement(command.locator, { allowHidden: true });
  if (!(target instanceof Element)) {
    throw new Error("Failed to resolve the locator target.");
  }

  return {
    page: buildPageRecord(),
    innerHTML: target.innerHTML,
  };
}

async function executeKeyboardType(command) {
  const text = typeof command?.text === "string" ? command.text : "";
  if (!text) {
    throw new Error("keyboard.type requires a non-empty text string.");
  }

  const delayMs = typeof command?.delay === "number" && Number.isFinite(command.delay) ? Math.max(0, command.delay) : 0;
  const target = document.activeElement instanceof Element ? document.activeElement : document.body;

  for (const char of text) {
    const code = char === " " ? "Space" : `Key${char.toUpperCase()}`;
    const keydownEvent = new KeyboardEvent("keydown", {
      key: char,
      code,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    });
    target.dispatchEvent(keydownEvent);

    const keypressEvent = new KeyboardEvent("keypress", {
      key: char,
      code,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    });
    target.dispatchEvent(keypressEvent);

    if (typeof InputEvent === "function") {
      const inputEvent = new InputEvent("input", {
        data: char,
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      target.dispatchEvent(inputEvent);
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const pos = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
      const end = typeof target.selectionEnd === "number" ? target.selectionEnd : pos;
      target.value = target.value.slice(0, pos) + char + target.value.slice(end);
      target.selectionStart = target.selectionEnd = pos + 1;
    } else if (target instanceof HTMLElement && target.isContentEditable) {
      const selection = window.getSelection?.();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(char));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    const keyupEvent = new KeyboardEvent("keyup", {
      key: char,
      code,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    });
    target.dispatchEvent(keyupEvent);

    if (delayMs > 0) {
      await waitForDelay(delayMs);
    }
  }

  return {
    page: buildPageRecord(),
    typedText: text,
    targetElement: target instanceof Element ? describeElementForCommand(target) : null,
  };
}

async function executeMouseWheel(command) {
  return interaction.executeMouseWheelCommand({
    deltaX: command.deltaX,
    deltaY: command.deltaY,
    x: command.x,
    y: command.y,
  });
}

async function executePageGoBack() {
  history.back();
  await waitForDelay(100);
  return {
    page: buildPageRecord(),
  };
}

async function executePageGoForward() {
  history.forward();
  await waitForDelay(100);
  return {
    page: buildPageRecord(),
  };
}


async function executePageWaitForLoadState(command) {
  const state = typeof command?.state === "string" ? command.state : "load";
  const timeoutMs =
    typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) ? command.timeoutMs : 30_000;

  if (state === "domcontentloaded") {
    if (document.readyState === "interactive" || document.readyState === "complete") {
      return { page: buildPageRecord(), loadState: state };
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for load state "${state}".`)), timeoutMs);
      document.addEventListener("DOMContentLoaded", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  } else if (state === "load") {
    if (document.readyState === "complete") {
      return { page: buildPageRecord(), loadState: state };
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for load state "${state}".`)), timeoutMs);
      window.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  } else if (state === "networkidle") {
    await waitForNetworkIdle(timeoutMs);
  } else {
    throw new Error(`Unsupported load state: "${state}". Use "load", "domcontentloaded", or "networkidle".`);
  }

  return { page: buildPageRecord(), loadState: state };
}

const xhrNetworkIdleTrackedSymbol = Symbol("kumaNetworkIdleTracked");

const networkIdlePatchState = {
  activePatchCount: 0,
  pendingRequests: 0,
  waiters: new Set(),
  originalFetch: null,
  originalXHROpen: null,
  originalXHRSend: null,
};

function notifyNetworkIdleWaiters(methodName) {
  for (const waiter of networkIdlePatchState.waiters) {
    waiter[methodName]();
  }
}

function handleNetworkIdleRequestStart() {
  networkIdlePatchState.pendingRequests += 1;
  notifyNetworkIdleWaiters("onRequestStart");
}

function handleNetworkIdleRequestEnd() {
  networkIdlePatchState.pendingRequests = Math.max(0, networkIdlePatchState.pendingRequests - 1);
  notifyNetworkIdleWaiters("onRequestEnd");
}

function retainNetworkIdlePatch() {
  if (networkIdlePatchState.activePatchCount === 0) {
    networkIdlePatchState.originalFetch = window.fetch;
    networkIdlePatchState.originalXHROpen = XMLHttpRequest.prototype.open;
    networkIdlePatchState.originalXHRSend = XMLHttpRequest.prototype.send;

    if (typeof networkIdlePatchState.originalFetch === "function") {
      window.fetch = function (...args) {
        handleNetworkIdleRequestStart();
        try {
          return Promise.resolve(networkIdlePatchState.originalFetch.apply(this, args)).finally(handleNetworkIdleRequestEnd);
        } catch (error) {
          handleNetworkIdleRequestEnd();
          throw error;
        }
      };
    }

    XMLHttpRequest.prototype.open = function (...args) {
      this[xhrNetworkIdleTrackedSymbol] = true;
      return networkIdlePatchState.originalXHROpen.apply(this, args);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (!this[xhrNetworkIdleTrackedSymbol]) {
        return networkIdlePatchState.originalXHRSend.apply(this, args);
      }

      handleNetworkIdleRequestStart();
      this.addEventListener("loadend", handleNetworkIdleRequestEnd, { once: true });

      try {
        return networkIdlePatchState.originalXHRSend.apply(this, args);
      } catch (error) {
        handleNetworkIdleRequestEnd();
        throw error;
      }
    };
  }

  networkIdlePatchState.activePatchCount += 1;
}

function releaseNetworkIdlePatch() {
  networkIdlePatchState.activePatchCount = Math.max(0, networkIdlePatchState.activePatchCount - 1);
  if (networkIdlePatchState.activePatchCount > 0) {
    return;
  }

  window.fetch = networkIdlePatchState.originalFetch;
  XMLHttpRequest.prototype.open = networkIdlePatchState.originalXHROpen;
  XMLHttpRequest.prototype.send = networkIdlePatchState.originalXHRSend;
  networkIdlePatchState.originalFetch = null;
  networkIdlePatchState.originalXHROpen = null;
  networkIdlePatchState.originalXHRSend = null;
  networkIdlePatchState.pendingRequests = 0;
}

function waitForNetworkIdle(timeoutMs) {
  return new Promise((resolve, reject) => {
    const idleThresholdMs = 2000;
    const waiter = {
      pendingRequests: networkIdlePatchState.pendingRequests,
      idleTimer: null,
      overallTimer: null,
      settled: false,
      onRequestStart() {
        this.pendingRequests += 1;
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
      },
      onRequestEnd() {
        this.pendingRequests = Math.max(0, this.pendingRequests - 1);
        if (this.pendingRequests === 0) {
          this.idleTimer = setTimeout(() => {
            cleanup();
            resolve();
          }, idleThresholdMs);
        }
      },
    };

    function cleanup() {
      if (waiter.settled) {
        return;
      }

      waiter.settled = true;
      if (waiter.overallTimer) {
        clearTimeout(waiter.overallTimer);
        waiter.overallTimer = null;
      }
      if (waiter.idleTimer) {
        clearTimeout(waiter.idleTimer);
        waiter.idleTimer = null;
      }

      networkIdlePatchState.waiters.delete(waiter);
      releaseNetworkIdlePatch();
    }

    retainNetworkIdlePatch();
    networkIdlePatchState.waiters.add(waiter);

    waiter.overallTimer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for network idle."));
    }, timeoutMs);

    if (waiter.pendingRequests === 0) {
      waiter.idleTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, idleThresholdMs);
    }
  });
}

function resolveIframeDocument(command) {
  const selector = typeof command?.selector === "string" ? command.selector.trim() : "";
  if (!selector) {
    throw new Error("page.frame requires a non-empty iframe selector.");
  }

  const iframe = document.querySelector(selector);
  if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
    throw new Error(`No iframe found matching selector "${selector}".`);
  }

  let iframeDoc;
  try {
    iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  } catch (e) {
    throw new Error(`Cannot access iframe "${selector}": cross-origin access is not supported.`);
  }

  if (!iframeDoc) {
    throw new Error(`Cannot access iframe "${selector}": contentDocument is null (likely cross-origin).`);
  }

  return iframeDoc;
}

async function executeFrameLocatorAction(command) {
  const iframeDoc = resolveIframeDocument(command);
  const innerCommand = command.innerCommand;
  if (!innerCommand || typeof innerCommand !== "object") {
    throw new Error("frameLocator action requires an innerCommand.");
  }

  if (innerCommand.locator) {
    innerCommand.locator._iframeContext = iframeDoc;
  }
  if (innerCommand.selector && !innerCommand.locator) {
    innerCommand._iframeContext = iframeDoc;
  }

  return executeAutomationCommand({ ...innerCommand, type: "playwright" });
}

async function executePageFrameEvaluate(command) {
  const iframeDoc = resolveIframeDocument(command);
  return {
    page: buildPageRecord(),
    frameUrl: iframeDoc.location?.href ?? null,
    frameTitle: iframeDoc.title ?? null,
  };
}

async function executeHoverAndClick(command) {
  const hoverSelector = typeof command?.hoverSelector === "string" ? command.hoverSelector.trim() : "";
  const clickSelector = typeof command?.clickSelector === "string" ? command.clickSelector.trim() : "";
  const waitMs = typeof command?.waitMs === "number" && Number.isFinite(command.waitMs) ? command.waitMs : 500;
  const timeoutMs =
    typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) ? command.timeoutMs : 30_000;

  if (!hoverSelector || !clickSelector) {
    throw new Error("hoverAndClick requires both hoverSelector and clickSelector.");
  }

  const hoverTarget = resolveSelectorTarget(hoverSelector, document, { allowHidden: true });
  if (!hoverTarget || !(hoverTarget instanceof Element)) {
    throw new Error(`hoverAndClick: no element found for hover selector "${hoverSelector}".`);
  }

  await interaction.executeHoverCommand({ targetElement: hoverTarget });
  await waitForDelay(waitMs);

  const clickTarget = await waitForSelectorWithObserver(clickSelector, "visible", timeoutMs);
  if (!clickTarget || !(clickTarget instanceof Element)) {
    throw new Error(`hoverAndClick: click target "${clickSelector}" did not appear after hover.`);
  }

  const clickResult = await interaction.executeClickCommand({ targetElement: clickTarget });

  return {
    page: buildPageRecord(),
    hoveredElement: describeElementForCommand(hoverTarget),
    clickedElement: describeElementForCommand(clickTarget),
    ...clickResult,
  };
}

async function executeAutomationCommand(command) {
  if (command?.type !== "playwright") {
    throw new Error(`Unsupported automation payload: ${String(command?.type)}`);
  }

  switch (command.action) {
    case "page.title":
      return executePageTitle();
    case "page.evaluate":
      return executePageEvaluate(command);
    case "page.waitForSelector":
      return executePageWaitForSelector(command);
    case "locator.click":
      return executeLocatorClick(command);
    case "locator.fill":
      return executeLocatorFill(command);
    case "locator.press":
      return executeLocatorPress(command);
    case "locator.textContent":
      return executeLocatorTextContent(command);
    case "locator.inputValue":
      return executeLocatorInputValue(command);
    case "locator.isVisible":
      return executeLocatorIsVisible(command);
    case "locator.waitFor":
      return executeLocatorWaitFor(command);
    case "locator.measure":
      return executeLocatorMeasure(command);
    case "keyboard.press":
      return executeKeyboardPress(command);
    case "keyboard.down":
      return executeKeyboardDown(command);
    case "keyboard.up":
      return executeKeyboardUp(command);
    case "mouse.move":
      return executeMouseMove(command);
    case "mouse.click":
      return executeMouseClick(command);
    case "mouse.down":
      return executeMouseDown(command);
    case "mouse.up":
      return executeMouseUp(command);
    case "mouse.drag":
      return executeMouseDrag(command);
    case "locator.hover":
      return executeLocatorHover(command);
    case "locator.dblclick":
      return executeLocatorDblClick(command);
    case "locator.getAttribute":
      return executeLocatorGetAttribute(command);
    case "locator.innerText":
      return executeLocatorInnerText(command);
    case "locator.innerHTML":
      return executeLocatorInnerHTML(command);
    case "keyboard.type":
      return executeKeyboardType(command);
    case "mouse.wheel":
      return executeMouseWheel(command);
    case "page.goBack":
      return executePageGoBack();
    case "page.goForward":
      return executePageGoForward();
    case "page.waitForLoadState":
      return executePageWaitForLoadState(command);
    case "page.frameLocator":
      return executeFrameLocatorAction(command);
    case "page.frame":
      return executePageFrameEvaluate(command);
    case "page.hoverAndClick":
      return executeHoverAndClick(command);
    default:
      throw new Error(`Unsupported Kuma Playwright action: ${String(command.action)}`);
  }
}

globalThis.KumaPickerExtensionPlaywrightRuntime = {
  executeAutomationCommand,
};
})();
