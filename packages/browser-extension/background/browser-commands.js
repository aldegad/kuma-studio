const CONTENT_SCRIPT_UNAVAILABLE_ERROR =
  "This page does not accept the Kuma Picker automation runtime. Try a regular website tab instead of a browser-internal page.";
const AUTOMATION_RUNTIME_NOT_READY_ERROR = "The Kuma Picker automation runtime is not loaded for this page yet.";
const AUTOMATION_RETRY_DELAYS_MS = [30, 50, 80, 120, 160, 220, 300];
const SCRIPT_RUNNER_DEFAULT_TIMEOUT_MS = 15_000;

function isTransientAutomationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message === CONTENT_SCRIPT_UNAVAILABLE_ERROR || message === AUTOMATION_RUNTIME_NOT_READY_ERROR;
}

function getAutomationRetryDelayMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0) {
    return AUTOMATION_RETRY_DELAYS_MS[0];
  }

  return AUTOMATION_RETRY_DELAYS_MS[Math.min(attempt, AUTOMATION_RETRY_DELAYS_MS.length - 1)];
}

async function collectPageContext(tabId) {
  const response = await sendMessageToTab(tabId, {
    type: "kuma-picker:collect-page",
  });

  if (!response?.ok || !response.pageContext) {
    throw new Error(response?.error || "Failed to read the page.");
  }

  return response.pageContext;
}

function buildPageRecordFromTab(tab) {
  const url = typeof tab?.url === "string" ? tab.url : null;
  let pathname = null;

  if (url) {
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = null;
    }
  }

  return {
    url,
    pathname,
    title: typeof tab?.title === "string" ? tab.title : null,
  };
}

async function sendAutomationCommandToTab(tabId, command) {
  let response = null;
  let lastError = null;

  await ensureAutomationBridge(tabId);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      response = await sendMessageToTab(tabId, {
        type: "kuma-picker:automation-command",
        command,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientAutomationError(error)) {
        break;
      }

      invalidateAutomationBridge(tabId);
      await ensureAutomationBridge(tabId);
      await waitForDelay(getAutomationRetryDelayMs(attempt));
      continue;
    }

    if (response?.ok) {
      return response.result ?? null;
    }

    if (response?.error !== AUTOMATION_RUNTIME_NOT_READY_ERROR) {
      break;
    }

    invalidateAutomationBridge(tabId);
    await ensureAutomationBridge(tabId);
    await waitForDelay(getAutomationRetryDelayMs(attempt));
  }

  if (!response?.ok) {
    throw lastError instanceof Error
      ? lastError
      : new Error(response?.error || "The active tab rejected the automation request.");
  }

  return response.result ?? null;
}

function normalizeScreenshotClipRect(command) {
  const candidate = command?.clip;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const rect = {
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0,
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0,
  };

  return rect.width >= 1 && rect.height >= 1 ? rect : null;
}

function getRefreshTimeoutMs(command) {
  return typeof command?.timeoutMs === "number" && Number.isFinite(command.timeoutMs) && command.timeoutMs > 0
    ? command.timeoutMs
    : 15_000;
}

function parseScreenshotBase64(dataUrl) {
  const matched = /^data:([^;]+);base64,(.+)$/u.exec(String(dataUrl ?? ""));
  if (!matched) {
    throw new Error("Failed to decode the captured browser screenshot.");
  }

  return {
    mimeType: matched[1] || "image/png",
    base64: matched[2],
  };
}

function createScriptRunnerUnsupportedProxy(label, target) {
  return new Proxy(target, {
    get(currentTarget, property, receiver) {
      if (Reflect.has(currentTarget, property)) {
        return Reflect.get(currentTarget, property, receiver);
      }

      if (typeof property === "symbol") {
        return Reflect.get(currentTarget, property, receiver);
      }

      throw new Error(`Unsupported Kuma Playwright API: ${label}.${String(property)}`);
    },
  });
}

function serializeScriptLogValue(value) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createCapturedScriptConsole() {
  const logs = [];

  function push(level, args) {
    logs.push({
      level,
      message: args.map((entry) => serializeScriptLogValue(entry)).join(" "),
    });
  }

  return {
    logs,
    console: {
      log: (...args) => push("log", args),
      info: (...args) => push("info", args),
      warn: (...args) => push("warn", args),
      error: (...args) => push("error", args),
    },
  };
}

function detectScriptPattern(source) {
  if (/\bmodule\s*\.\s*exports\b/.test(source)) {
    return "commonjs";
  }

  if (
    /\bexport\s+default\b/.test(source) ||
    /\bexport\s+(?:async\s+)?function\b/.test(source) ||
    /\bexport\s*\{/.test(source)
  ) {
    return "esm";
  }

  return "top-level";
}

function stripEsmExports(source) {
  return source
    .replace(/\bexport\s+default\s+/g, "__default_export__ = ")
    .replace(/\bexport\s+(?=async\s+function|function|const|let|var|class)/g, "")
    .replace(/\bexport\s*\{[^}]*\}\s*;?/g, "");
}

function normalizeScriptRunnerClip(clip) {
  if (!clip || typeof clip !== "object") {
    return null;
  }

  const x = Number(clip.x);
  const y = Number(clip.y);
  const width = Number(clip.width);
  const height = Number(clip.height);

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    throw new Error("page.screenshot clip requires finite x, y, width, and height values.");
  }

  return {
    x,
    y,
    width,
    height,
  };
}

function normalizeScriptRunnerSelectValues(values) {
  const list = Array.isArray(values) ? values : [values];
  if (list.length === 0) {
    throw new Error("locator.selectOption requires at least one value.");
  }

  return list.map((value) => {
    if (typeof value === "string") {
      return value;
    }

    if (value && typeof value === "object") {
      if (typeof value.label === "string") {
        return { label: value.label };
      }

      if (Number.isInteger(value.index) && value.index >= 0) {
        return { index: value.index };
      }
    }

    throw new Error("locator.selectOption requires a string, { label }, { index }, or an array of those values.");
  });
}

function serializeScriptEvaluateInput(fnOrExpression, arg) {
  if (typeof fnOrExpression === "function") {
    return {
      kind: "function",
      source: fnOrExpression.toString(),
      arg: arg === undefined ? null : arg,
    };
  }

  if (typeof fnOrExpression === "string" && fnOrExpression.trim()) {
    return {
      kind: "expression",
      source: fnOrExpression.trim(),
      arg: arg === undefined ? null : arg,
    };
  }

  throw new Error("page.evaluate requires a function or non-empty expression string.");
}

function createScriptRunnerState(tab) {
  return {
    tabId: tab.id,
    mousePoint: null,
    url: typeof tab?.url === "string" ? tab.url : null,
    pathname: typeof tab?.url === "string" ? (() => {
      try {
        return new URL(tab.url).pathname;
      } catch {
        return null;
      }
    })() : null,
    title: typeof tab?.title === "string" ? tab.title : null,
  };
}

function updateScriptRunnerState(state, payload) {
  const page = payload?.page;
  if (!page || typeof page !== "object") {
    return;
  }

  if (typeof page.url === "string" && page.url) {
    state.url = page.url;
  }
  if (typeof page.pathname === "string") {
    state.pathname = page.pathname;
  }
  if (typeof page.title === "string") {
    state.title = page.title;
  }
}

function createScriptRunnerLocator(client, state, descriptor) {
  function withDescriptor(fields) {
    return createScriptRunnerLocator(client, state, {
      ...descriptor,
      ...fields,
    });
  }

  const locator = {
    async click(options = {}) {
      const result = await client.send("locator.click", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async fill(value, options = {}) {
      const result = await client.send(
        "locator.fill",
        {
          locator: descriptor,
          value: String(value ?? ""),
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async selectOption(values, options = {}) {
      const result = await client.send(
        "locator.selectOption",
        {
          locator: descriptor,
          values: normalizeScriptRunnerSelectValues(values),
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async press(key, options = {}) {
      const result = await client.send(
        "locator.press",
        {
          locator: descriptor,
          key,
          holdMs: Number.isFinite(options.holdMs) ? Math.round(options.holdMs) : null,
          shiftKey: options.shift === true,
          altKey: options.alt === true,
          ctrlKey: options.ctrl === true,
          metaKey: options.meta === true,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async textContent() {
      const result = await client.send("locator.textContent", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.textContent ?? null;
    },
    async inputValue() {
      const result = await client.send("locator.inputValue", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.inputValue ?? null;
    },
    async isVisible() {
      const result = await client.send("locator.isVisible", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.visible === true;
    },
    async boundingBox() {
      const result = await client.send("locator.measure", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.rect ?? null;
    },
    async scrollIntoViewIfNeeded(options = {}) {
      const result = await client.send("locator.scrollIntoViewIfNeeded", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async waitFor(options = {}) {
      const result = await client.send(
        "locator.waitFor",
        {
          locator: descriptor,
          state: options.state ?? "visible",
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async hover(options = {}) {
      const result = await client.send("locator.hover", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async dblclick(options = {}) {
      const result = await client.send("locator.dblclick", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async getAttribute(name) {
      const result = await client.send("locator.getAttribute", {
        locator: descriptor,
        name: String(name ?? ""),
      });
      updateScriptRunnerState(state, result);
      return result?.attributeValue ?? null;
    },
    async innerText() {
      const result = await client.send("locator.innerText", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.innerText ?? null;
    },
    async innerHTML() {
      const result = await client.send("locator.innerHTML", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.innerHTML ?? null;
    },
    async screenshot(options = {}) {
      const measurement = await client.send("locator.measure", { locator: descriptor }, options);
      updateScriptRunnerState(state, measurement);
      if (!measurement?.rect) {
        throw new Error("locator.screenshot requires a measurable target rect.");
      }

      const result = await client.send(
        "page.screenshot",
        {
          clip: measurement.rect,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result?.screenshot?.dataUrl ?? null;
    },
    async focus(options = {}) {
      const result = await client.send("locator.focus", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async blur(options = {}) {
      const result = await client.send("locator.blur", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async check(options = {}) {
      const result = await client.send("locator.check", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async uncheck(options = {}) {
      const result = await client.send("locator.uncheck", { locator: descriptor }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async count() {
      const result = await client.send("locator.count", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return Number.isInteger(result?.count) ? result.count : 0;
    },
    async isEnabled() {
      const result = await client.send("locator.isEnabled", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.enabled === true;
    },
    async isChecked() {
      const result = await client.send("locator.isChecked", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.checked === true;
    },
    async isDisabled() {
      const result = await client.send("locator.isDisabled", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.disabled === true;
    },
    async isEditable() {
      const result = await client.send("locator.isEditable", { locator: descriptor });
      updateScriptRunnerState(state, result);
      return result?.editable === true;
    },
    first() {
      return withDescriptor({ nth: 0 });
    },
    last() {
      return withDescriptor({ nth: "last" });
    },
    nth(index) {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error("locator.nth requires a non-negative integer index.");
      }

      return withDescriptor({ nth: index });
    },
  };

  return createScriptRunnerUnsupportedProxy("locator", locator);
}

function createScriptRunnerClient(tab, state) {
  return {
    async send(action, payload = {}, options = {}) {
      const currentTab = await chrome.tabs.get(state.tabId);
      const result = await executePlaywrightCommand(currentTab, {
        type: "playwright",
        action,
        ...payload,
        resolvedTargetTabId: state.tabId,
        timeoutMs:
          Number.isFinite(options?.timeout) && options.timeout > 0
            ? Math.round(options.timeout)
            : SCRIPT_RUNNER_DEFAULT_TIMEOUT_MS,
      });
      updateScriptRunnerState(state, result);
      return result;
    },
  };
}

function createScriptRunnerPage(tab) {
  const state = createScriptRunnerState(tab);
  const client = createScriptRunnerClient(tab, state);

  const keyboard = createScriptRunnerUnsupportedProxy("page.keyboard", {
    async press(key, options = {}) {
      const result = await client.send(
        "keyboard.press",
        {
          key,
          holdMs: Number.isFinite(options.holdMs) ? Math.round(options.holdMs) : null,
          shiftKey: options.shift === true,
          altKey: options.alt === true,
          ctrlKey: options.ctrl === true,
          metaKey: options.meta === true,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async down(key, modifiers = {}) {
      const result = await client.send("keyboard.down", {
        key,
        shiftKey: modifiers.shift === true,
        altKey: modifiers.alt === true,
        ctrlKey: modifiers.ctrl === true,
        metaKey: modifiers.meta === true,
      });
      updateScriptRunnerState(state, result);
      return result;
    },
    async up(key, modifiers = {}) {
      const result = await client.send("keyboard.up", {
        key,
        shiftKey: modifiers.shift === true,
        altKey: modifiers.alt === true,
        ctrlKey: modifiers.ctrl === true,
        metaKey: modifiers.meta === true,
      });
      updateScriptRunnerState(state, result);
      return result;
    },
    async type(text, options = {}) {
      const result = await client.send(
        "keyboard.type",
        {
          text: String(text ?? ""),
          delay: Number.isFinite(options.delay) ? Math.round(options.delay) : 0,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
  });

  const mouse = createScriptRunnerUnsupportedProxy("page.mouse", {
    async click(x, y, options = {}) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("page.mouse.click requires finite x/y coordinates.");
      }

      const result = await client.send(
        "mouse.click",
        {
          x,
          y,
          button: options.button ?? "left",
        },
        options,
      );
      updateScriptRunnerState(state, result);
      state.mousePoint = { x, y };
      return result;
    },
    async move(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("page.mouse.move requires finite x/y coordinates.");
      }

      const result = await client.send("mouse.move", { x, y });
      updateScriptRunnerState(state, result);
      state.mousePoint = { x, y };
      return result;
    },
    async down(options = {}) {
      const point =
        Number.isFinite(options.x) && Number.isFinite(options.y)
          ? { x: options.x, y: options.y }
          : state.mousePoint;
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
        throw new Error("page.mouse.down requires x/y coordinates. Call page.mouse.move(x, y) first or pass explicit coordinates.");
      }

      const result = await client.send("mouse.down", {
        x: point.x,
        y: point.y,
        button: options.button ?? "left",
      });
      updateScriptRunnerState(state, result);
      state.mousePoint = point;
      return result;
    },
    async up(options = {}) {
      const point =
        Number.isFinite(options.x) && Number.isFinite(options.y)
          ? { x: options.x, y: options.y }
          : state.mousePoint;
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
        throw new Error("page.mouse.up requires x/y coordinates. Call page.mouse.move(x, y) first or pass explicit coordinates.");
      }

      const result = await client.send("mouse.up", {
        x: point.x,
        y: point.y,
        button: options.button ?? "left",
      });
      updateScriptRunnerState(state, result);
      state.mousePoint = point;
      return result;
    },
    async drag(from, to, options = {}) {
      const result = await client.send(
        "mouse.drag",
        {
          from,
          to,
          durationMs: Number.isFinite(options.durationMs) ? Math.round(options.durationMs) : 500,
          steps: Number.isFinite(options.steps) ? Math.round(options.steps) : null,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      if (Number.isFinite(to?.x) && Number.isFinite(to?.y)) {
        state.mousePoint = { x: to.x, y: to.y };
      }
      return result;
    },
    async wheel(deltaX, deltaY, options = {}) {
      const result = await client.send(
        "mouse.wheel",
        {
          deltaX: Number.isFinite(deltaX) ? deltaX : 0,
          deltaY: Number.isFinite(deltaY) ? deltaY : 0,
          x: Number.isFinite(options.x) ? options.x : null,
          y: Number.isFinite(options.y) ? options.y : null,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
  });

  const page = {
    keyboard,
    mouse,
    async goto(url, options = {}) {
      const result = await client.send(
        "page.goto",
        {
          url,
          waitUntil: options.waitUntil ?? null,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async reload(options = {}) {
      const result = await client.send(
        "page.reload",
        {
          bypassCache: options.bypassCache === true,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    url() {
      return state.url ?? null;
    },
    async title() {
      const result = await client.send("page.title");
      updateScriptRunnerState(state, result);
      return result?.title ?? null;
    },
    async screenshot(options = {}) {
      const result = await client.send(
        "page.screenshot",
        {
          selector: typeof options.selector === "string" ? options.selector : null,
          clip: normalizeScriptRunnerClip(options.clip),
          fullPage: options.fullPage === true,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result?.screenshot?.dataUrl ?? null;
    },
    async evaluate(fnOrExpression, arg) {
      const result = await client.send("page.evaluate", serializeScriptEvaluateInput(fnOrExpression, arg));
      updateScriptRunnerState(state, result);
      return result?.value ?? null;
    },
    locator(selector) {
      if (typeof selector !== "string" || !selector.trim()) {
        throw new Error("page.locator requires a non-empty selector.");
      }

      return createScriptRunnerLocator(client, state, {
        kind: "selector",
        selector: selector.trim(),
      });
    },
    async focus(selector, options = {}) {
      const result = await client.send(
        "locator.focus",
        {
          locator: {
            kind: "selector",
            selector: String(selector ?? "").trim(),
          },
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async blur(selector, options = {}) {
      const result = await client.send(
        "locator.blur",
        {
          locator: {
            kind: "selector",
            selector: String(selector ?? "").trim(),
          },
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async scrollIntoViewIfNeeded(selector, options = {}) {
      const result = await client.send(
        "locator.scrollIntoViewIfNeeded",
        {
          locator: {
            kind: "selector",
            selector: String(selector ?? "").trim(),
          },
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    getByText(text, options = {}) {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("page.getByText requires a non-empty text value.");
      }

      return createScriptRunnerLocator(client, state, {
        kind: "text",
        text: text.trim(),
        exact: options.exact === true,
      });
    },
    getByRole(role, options = {}) {
      if (typeof role !== "string" || !role.trim()) {
        throw new Error("page.getByRole requires a non-empty role.");
      }

      return createScriptRunnerLocator(client, state, {
        kind: "role",
        role: role.trim(),
        name: typeof options.name === "string" && options.name.trim() ? options.name.trim() : null,
        exact: options.exact === true,
      });
    },
    getByLabel(text, options = {}) {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("page.getByLabel requires a non-empty label.");
      }

      return createScriptRunnerLocator(client, state, {
        kind: "label",
        text: text.trim(),
        exact: options.exact === true,
      });
    },
    getByPlaceholder(text, options = {}) {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("page.getByPlaceholder requires a non-empty placeholder text.");
      }

      return createScriptRunnerLocator(client, state, {
        kind: "placeholder",
        text: text.trim(),
        exact: options.exact === true,
      });
    },
    getByTestId(testId) {
      if (typeof testId !== "string" || !testId.trim()) {
        throw new Error("page.getByTestId requires a non-empty test ID.");
      }

      return createScriptRunnerLocator(client, state, {
        kind: "testid",
        testId: testId.trim(),
      });
    },
    async waitForSelector(selector, options = {}) {
      const result = await client.send(
        "page.waitForSelector",
        {
          selector: String(selector ?? "").trim(),
          state: options.state ?? "visible",
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async setViewportSize({ width, height } = {}) {
      const result = await client.send("page.setViewportSize", {
        width: Math.round(width),
        height: Math.round(height),
      });
      updateScriptRunnerState(state, result);
      return result;
    },
    async waitForLoadState(loadState = "load", options = {}) {
      const result = await client.send(
        "page.waitForLoadState",
        {
          state: loadState,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async waitForURL(urlOrPattern, options = {}) {
      let value = urlOrPattern;
      if (urlOrPattern instanceof RegExp) {
        value = {
          type: "regex",
          source: urlOrPattern.source,
          flags: urlOrPattern.flags,
        };
      }

      const result = await client.send("page.waitForURL", { value }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async waitForResponse(urlPattern, options = {}) {
      const result = await client.send(
        "page.waitForResponse",
        {
          urlPattern: String(urlPattern ?? "").trim(),
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async waitForRequest(urlPattern, options = {}) {
      const result = await client.send(
        "page.waitForRequest",
        {
          urlPattern: String(urlPattern ?? "").trim(),
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async goBack(options = {}) {
      const result = await client.send("page.goBack", {}, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async goForward(options = {}) {
      const result = await client.send("page.goForward", {}, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async content() {
      const result = await client.send("page.content", {});
      updateScriptRunnerState(state, result);
      return result?.content ?? "";
    },
    async setContent(html, options = {}) {
      const result = await client.send("page.setContent", { html: String(html ?? "") }, options);
      updateScriptRunnerState(state, result);
      return result;
    },
    async hoverAndClick(hoverSelector, clickSelector, waitMs = 500, options = {}) {
      const result = await client.send(
        "page.hoverAndClick",
        {
          hoverSelector: String(hoverSelector ?? "").trim(),
          clickSelector: String(clickSelector ?? "").trim(),
          waitMs: Number.isFinite(waitMs) ? Math.round(waitMs) : 500,
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
    async dragAndDrop(source, target, options = {}) {
      const result = await client.send(
        "page.dragAndDrop",
        {
          source: String(source ?? "").trim(),
          target: String(target ?? "").trim(),
        },
        options,
      );
      updateScriptRunnerState(state, result);
      return result;
    },
  };

  return createScriptRunnerUnsupportedProxy("page", page);
}

async function executePlaywrightScriptRun(tab, command) {
  const source = typeof command?.source === "string" ? command.source : "";
  if (!source.trim()) {
    throw new Error("script.run requires a non-empty script source.");
  }

  const page = createScriptRunnerPage(tab);
  const { console: scriptConsole, logs } = createCapturedScriptConsole();
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;
  const pattern = detectScriptPattern(source);
  let value = null;

  if (pattern === "commonjs") {
    const moduleObj = { exports: {} };
    const executor = new AsyncFunction(
      "page",
      "console",
      "module",
      "exports",
      "chrome",
      "globalThis",
      `"use strict";
${source}
const __exported = module.exports;
const __run = typeof __exported === "function" ? __exported : __exported?.run;
if (typeof __run === "function") {
  return await __run({ page, console, chrome, globalThis });
}
return null;
`,
    );
    value = await executor(page, scriptConsole, moduleObj, moduleObj.exports, chrome, globalThis);
    return {
      page: buildPageRecordFromTab(await chrome.tabs.get(tab.id)),
      value,
      logs,
    };
  }

  if (pattern === "esm") {
    const strippedSource = stripEsmExports(source);
    const executor = new AsyncFunction(
      "page",
      "console",
      "chrome",
      "globalThis",
      `"use strict";
let __default_export__;
${strippedSource}
const __run = typeof run === "function" ? run : __default_export__;
if (typeof __run === "function") {
  return await __run({ page, console, chrome, globalThis });
}
return null;
`,
    );
    value = await executor(page, scriptConsole, chrome, globalThis);
    return {
      page: buildPageRecordFromTab(await chrome.tabs.get(tab.id)),
      value,
      logs,
    };
  }

  const executor = new AsyncFunction(
    "page",
    "console",
    "chrome",
    "globalThis",
    `"use strict"; return (async () => {\n${source}\n})();`,
  );
  value = await executor(page, scriptConsole, chrome, globalThis);
  return {
    page: buildPageRecordFromTab(await chrome.tabs.get(tab.id)),
    value,
    logs,
  };
}

async function executePageEvaluateCommand(tab, command) {
  try {
    return await executeDebuggerEvaluateCommand(tab, command);
  } catch (error) {
    if (!shouldFallbackDebuggerEvaluate(error)) {
      throw error;
    }

    const fallbackResult = await sendAutomationCommandToTab(tab.id, command);
    return {
      ...fallbackResult,
      executionWorld: fallbackResult?.executionWorld ?? "content-script",
      evaluateBackend: fallbackResult?.evaluateBackend ?? "content-script",
      fallbackUsed: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
      fallbackFrom: "debugger",
    };
  }
}

async function executePageScreenshotCommand(tab, command) {
  const fullPage = command?.fullPage === true;
  const pageContext = await collectPageContext(tab.id);
  const viewport = pageContext?.viewport ?? {};
  const viewportWidth = Number(viewport.width) || 0;
  const viewportHeight = Number(viewport.height) || 0;
  const devicePixelRatio = Number(viewport.devicePixelRatio) || 1;
  const scrollX = Number(viewport.scrollX) || 0;
  const scrollY = Number(viewport.scrollY) || 0;
  const scrollWidth = Number(viewport.scrollWidth) || viewportWidth;
  const scrollHeight = Number(viewport.scrollHeight) || viewportHeight;

  const selector = typeof command?.selector === "string" ? command.selector : null;
  const clipRect = normalizeScreenshotClipRect(command);

  if (fullPage && !selector && !clipRect) {
    // Capture the full page by scrolling through it and stitching strips together.
    const fullWidth = Math.max(viewportWidth, scrollWidth);
    const fullHeight = Math.max(viewportHeight, scrollHeight);
    const stitched = await captureFullPageScreenshot(tab, tab.id, {
      viewportWidth,
      viewportHeight,
      fullWidth,
      fullHeight,
      devicePixelRatio,
      scrollX,
      scrollY,
    });
    return {
      page: pageContext.page,
      screenshot: {
        dataUrl: stitched.dataUrl,
        mimeType: "image/png",
        width: stitched.width,
        height: stitched.height,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  const capture = await captureTargetTabScreenshot(tab, {
    focusTabFirst: true,
    restorePreviousActiveTab: false,
  });

  let screenshot = {
    dataUrl: capture.dataUrl,
    mimeType: "image/png",
    width: Math.max(0, Math.round(viewportWidth * devicePixelRatio)),
    height: Math.max(0, Math.round(viewportHeight * devicePixelRatio)),
    capturedAt: new Date().toISOString(),
  };

  if (selector || clipRect) {
    const measured = selector
      ? await sendAutomationCommandToTab(tab.id, {
          type: "playwright",
          action: "locator.measure",
          locator: {
            kind: "selector",
            selector,
          },
        })
      : null;
    // clip rect from locator.measure uses getBoundingClientRect() which is already
    // viewport-relative, so no scroll offset adjustment is needed here.
    const rect = clipRect ?? measured?.rect ?? null;
    const cropped = await cropTabScreenshot(capture.dataUrl, rect, viewport);
    screenshot = {
      dataUrl: cropped.dataUrl,
      mimeType: cropped.mimeType,
      width: cropped.width,
      height: cropped.height,
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    page: pageContext.page,
    screenshot,
  };
}

async function executeBrowserScreenshotCommand(tab, command) {
  const capture = await captureTargetTabScreenshot(tab, {
    focusTabFirst: command?.focusTabFirst !== false,
    restorePreviousActiveTab: command?.restorePreviousActiveTab === true,
  });
  const decoded = parseScreenshotBase64(capture.dataUrl);

  return {
    page: buildPageRecordFromTab(await chrome.tabs.get(tab.id)),
    screenshot: {
      mimeType: decoded.mimeType,
      base64: decoded.base64,
      capturedAt: new Date().toISOString(),
      tabId: capture.tabId ?? tab.id,
      windowId: capture.windowId ?? tab.windowId,
    },
  };
}

async function captureFullPageScreenshot(tab, tabId, { viewportWidth, viewportHeight, fullWidth, fullHeight, devicePixelRatio, scrollX, scrollY }) {
  const strips = [];
  let captureY = 0;

  // Scroll through the page top-to-bottom, capturing viewport-sized strips.
  // Use the debugger path so window.scrollTo runs in the real page (main world),
  // not the isolated content-script world where scrollTo has no effect.
  while (captureY < fullHeight) {
    await executeDebuggerEvaluateCommand(tab, {
      kind: "function",
      source: `function(arg) { window.scrollTo(arg.x, arg.y); }`,
      arg: { x: 0, y: captureY },
    });

    // Small settle delay so the browser composites the new scroll position.
    await waitForDelay(60);

    const capture = await captureTargetTabScreenshot(tab, {
      focusTabFirst: true,
      restorePreviousActiveTab: false,
      paintSettleDelayMs: 0,
    });

    strips.push({ dataUrl: capture.dataUrl, offsetY: captureY });
    captureY += viewportHeight;
  }

  // Restore original scroll position.
  await executeDebuggerEvaluateCommand(tab, {
    kind: "function",
    source: `function(arg) { window.scrollTo(arg.x, arg.y); }`,
    arg: { x: scrollX, y: scrollY },
  }).catch(() => null);

  // Stitch strips into a single full-page image using OffscreenCanvas.
  const physicalWidth = Math.round(fullWidth * devicePixelRatio);
  const physicalHeight = Math.round(fullHeight * devicePixelRatio);
  const physicalViewportHeight = Math.round(viewportHeight * devicePixelRatio);
  const canvas = new OffscreenCanvas(physicalWidth, physicalHeight);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to create canvas context for full-page screenshot.");
  }

  for (const strip of strips) {
    const response = await fetch(strip.dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const destY = Math.round(strip.offsetY * devicePixelRatio);
      const sourceHeight = Math.min(physicalViewportHeight, physicalHeight - destY);
      ctx.drawImage(bitmap, 0, 0, bitmap.width, sourceHeight, 0, destY, physicalWidth, sourceHeight);
    } finally {
      bitmap.close();
    }
  }

  const resultBlob = await canvas.convertToBlob({ type: "image/png" });
  const resultBytes = new Uint8Array(await resultBlob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < resultBytes.length; i += chunkSize) {
    binary += String.fromCharCode(...resultBytes.subarray(i, i + chunkSize));
  }

  return {
    dataUrl: `data:image/png;base64,${btoa(binary)}`,
    width: physicalWidth,
    height: physicalHeight,
  };
}

async function executePageReloadCommand(tab, command) {
  const reloaded = await reloadTargetTab(tab, {
    bypassCache: command?.bypassCache === true,
    timeoutMs: getRefreshTimeoutMs(command),
  });

  return {
    page: buildPageRecordFromTab(reloaded.tab),
    bypassCache: reloaded.bypassCache,
    status: reloaded.tab.status ?? null,
  };
}

async function executePageGotoCommand(tab, command) {
  const navigationUrl = typeof command?.url === "string" ? command.url.trim() : "";
  if (!navigationUrl) {
    throw new Error("page.goto requires a non-empty URL.");
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(navigationUrl);
  } catch {
    throw new Error(`Invalid navigation URL: ${navigationUrl}`);
  }

  const navigationResult = await navigateTargetTab(tab, {
    url: parsedUrl.toString(),
    timeoutMs: getRefreshTimeoutMs(command),
  });

  return {
    page: buildPageRecordFromTab(navigationResult.tab),
    status: navigationResult.tab.status ?? null,
  };
}

async function executePlaywrightCommand(tab, command) {
  switch (command?.action) {
    case "page.goto":
      return executePageGotoCommand(tab, command);
    case "page.reload":
      return executePageReloadCommand(tab, command);
    case "page.evaluate":
      return executePageEvaluateCommand(tab, command);
    case "page.screenshot":
      return executePageScreenshotCommand(tab, command);
    case "script.run":
      return executePlaywrightScriptRun(tab, command);
    default:
      return sendAutomationCommandToTab(tab.id, command);
  }
}

async function executeBrowserCommand(tab, command) {
  if (command?.type === "screenshot") {
    return executeBrowserScreenshotCommand(tab, command);
  }

  if (command?.type !== "playwright") {
    throw new Error(`Unsupported Kuma Picker automation command: ${String(command?.type)}`);
  }

  return executePlaywrightCommand(tab, command);
}
