import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { createUnsupportedProxy, parseDataUrl, serializeEvaluateInput } from "./playwright-runner-support.mjs";

function toAbsolutePath(filePath) {
  return path.resolve(process.cwd(), filePath);
}

function createLocatorDescriptor(kind, fields) {
  return { kind, ...fields };
}

function cloneLocatorDescriptor(descriptor, fields) {
  return {
    ...descriptor,
    ...fields,
  };
}

function requireFinitePoint(point, label) {
  if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
    return {
      x: point.x,
      y: point.y,
    };
  }

  throw new Error(`${label} requires x/y coordinates. Call page.mouse.move(x, y) first or pass explicit coordinates.`);
}

function normalizeClipRect(clip) {
  if (clip == null) {
    return null;
  }

  if (
    typeof clip === "object" &&
    Number.isFinite(clip.x) &&
    Number.isFinite(clip.y) &&
    Number.isFinite(clip.width) &&
    Number.isFinite(clip.height)
  ) {
    return {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
    };
  }

  throw new Error("page.screenshot clip requires finite x, y, width, and height values.");
}

function writeScreenshotBuffer(buffer, filePath) {
  if (typeof filePath === "string" && filePath.trim()) {
    writeFileSync(toAbsolutePath(filePath), buffer);
  }
}

function normalizeSelectOptionValues(values) {
  const valueList = Array.isArray(values) ? values : [values];
  if (valueList.length === 0) {
    throw new Error("locator.selectOption requires at least one value.");
  }

  return valueList.map((value) => {
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

export function createPageState() {
  return {
    url: null,
    pathname: null,
    title: null,
    mousePoint: null,
  };
}

export function updatePageState(state, payload) {
  const pageRecord = payload?.page;
  if (!pageRecord || typeof pageRecord !== "object") {
    return;
  }

  if (typeof pageRecord.url === "string" && pageRecord.url) {
    state.url = pageRecord.url;
  }
  if (typeof pageRecord.title === "string") {
    state.title = pageRecord.title;
  }
  if (typeof pageRecord.pathname === "string") {
    state.pathname = pageRecord.pathname;
  }
}

export function createLocator(client, state, descriptor) {
  function withDescriptor(fields) {
    return createLocator(client, state, cloneLocatorDescriptor(descriptor, fields));
  }

  const locatorTarget = {
    async click(options = {}) {
      const result = await client.send(
        "locator.click",
        {
          locator: descriptor,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async fill(value, options = {}) {
      const result = await client.send(
        "locator.fill",
        {
          locator: descriptor,
          value: String(value ?? ""),
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async selectOption(values, options = {}) {
      const result = await client.send(
        "locator.selectOption",
        {
          locator: descriptor,
          values: normalizeSelectOptionValues(values),
          timeoutMs: Number.isFinite(options.timeout) ? Math.round(options.timeout) : null,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
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
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async textContent() {
      const result = await client.send("locator.textContent", {
        locator: descriptor,
      });
      updatePageState(state, result);
      return result?.textContent ?? null;
    },
    async inputValue() {
      const result = await client.send("locator.inputValue", {
        locator: descriptor,
      });
      updatePageState(state, result);
      return result?.inputValue ?? null;
    },
    async isVisible() {
      const result = await client.send("locator.isVisible", {
        locator: descriptor,
      });
      updatePageState(state, result);
      return result?.visible === true;
    },
    async boundingBox() {
      const result = await client.send("locator.measure", {
        locator: descriptor,
      });
      updatePageState(state, result);
      return result?.rect ?? null;
    },
    async waitFor(options = {}) {
      const result = await client.send(
        "locator.waitFor",
        {
          locator: descriptor,
          state: options.state ?? "visible",
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async hover(options = {}) {
      const result = await client.send(
        "locator.hover",
        {
          locator: descriptor,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async dblclick(options = {}) {
      const result = await client.send(
        "locator.dblclick",
        {
          locator: descriptor,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async getAttribute(name) {
      const result = await client.send("locator.getAttribute", {
        locator: descriptor,
        name: String(name ?? ""),
      });
      updatePageState(state, result);
      return result?.attributeValue ?? null;
    },
    async innerText() {
      const result = await client.send("locator.innerText", {
        locator: descriptor,
      });
      updatePageState(state, result);
      return result?.innerText ?? null;
    },
    async innerHTML() {
      const result = await client.send("locator.innerHTML", {
        locator: descriptor,
      });
      updatePageState(state, result);
      return result?.innerHTML ?? null;
    },
    async screenshot(options = {}) {
      const measurement = await client.send("locator.measure", {
        locator: descriptor,
      });
      updatePageState(state, measurement);
      const clip = normalizeClipRect(measurement?.rect);
      if (!clip) {
        throw new Error("locator.screenshot requires a measurable target rect.");
      }

      const result = await client.send("page.screenshot", {
        clip,
      });
      updatePageState(state, result);
      const buffer = parseDataUrl(result?.screenshot?.dataUrl);
      writeScreenshotBuffer(buffer, options.path);
      return buffer;
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
    async setInputFiles(files, options = {}) {
      const fileArray = Array.isArray(files) ? files : [files];
      const fileDescs = fileArray.map((f) => {
        if (typeof f === "string") {
          const absPath = toAbsolutePath(f);
          const fileBuffer = readFileSync(absPath);
          return { name: f.split("/").pop() || "file", base64: fileBuffer.toString("base64"), type: "application/octet-stream" };
        }
        return {
          name: f.name || "file",
          type: f.type || "application/octet-stream",
          content: typeof f.content === "string" ? f.content : undefined,
          base64: typeof f.base64 === "string" ? f.base64 : undefined,
        };
      });
      const result = await client.send(
        "locator.setInputFiles",
        {
          locator: descriptor,
          files: fileDescs,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async dragTo(targetLocator, options = {}) {
      if (!targetLocator || typeof targetLocator !== "object") {
        throw new Error("locator.dragTo requires a target locator.");
      }
      const destDescriptor = targetLocator._descriptor ?? targetLocator;
      const result = await client.send(
        "locator.dragTo",
        {
          locator: descriptor,
          destLocator: destDescriptor,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
  };

  locatorTarget._descriptor = descriptor;
  return createUnsupportedProxy("locator", locatorTarget);
}

export function createFrameHandle(client, state, iframeSelector) {
  const frameTarget = {
    async evaluate(fnOrExpression, arg) {
      const result = await client.send("page.frame", {
        selector: iframeSelector,
      });
      updatePageState(state, result);
      return result;
    },
    locator(selector) {
      return createFrameLocator(client, state, iframeSelector).locator(selector);
    },
    url() {
      return null; // Frame URL is only available after evaluate
    },
  };

  return createUnsupportedProxy("frame", frameTarget);
}

export function createFrameLocator(client, state, iframeSelector) {
  function wrapInnerCommand(action, params, options = {}) {
    const timeoutMs = Number.isFinite(options?.timeout) ? Math.round(options.timeout) : null;
    return client.send(
      "page.frameLocator",
      {
        selector: iframeSelector,
        innerCommand: {
          type: "playwright",
          action,
          ...params,
          timeoutMs,
        },
      },
      { timeoutMs: options.timeout },
    );
  }

  const frameLocatorTarget = {
    locator(selector) {
      if (typeof selector !== "string" || !selector.trim()) {
        throw new Error("frameLocator.locator requires a non-empty selector.");
      }
      const descriptor = { kind: "selector", selector: selector.trim() };

      const locatorTarget = {
        async click(options = {}) {
          const result = await wrapInnerCommand("locator.click", { locator: descriptor }, options);
          updatePageState(state, result);
          return result;
        },
        async fill(value, options = {}) {
          const result = await wrapInnerCommand("locator.fill", {
            locator: descriptor,
            value: String(value ?? ""),
          }, options);
          updatePageState(state, result);
          return result;
        },
        async selectOption(values, options = {}) {
          const result = await wrapInnerCommand(
            "locator.selectOption",
            {
              locator: descriptor,
              values: normalizeSelectOptionValues(values),
            },
            options,
          );
          updatePageState(state, result);
          return result;
        },
        async textContent() {
          const result = await wrapInnerCommand("locator.textContent", { locator: descriptor });
          updatePageState(state, result);
          return result?.textContent ?? null;
        },
        async innerText() {
          const result = await wrapInnerCommand("locator.innerText", { locator: descriptor });
          updatePageState(state, result);
          return result?.innerText ?? null;
        },
        async isVisible() {
          const result = await wrapInnerCommand("locator.isVisible", { locator: descriptor });
          updatePageState(state, result);
          return result?.visible === true;
        },
        async waitFor(options = {}) {
          const result = await wrapInnerCommand("locator.waitFor", {
            locator: descriptor,
            state: options.state ?? "visible",
          }, options);
          updatePageState(state, result);
          return result;
        },
        async press(key, options = {}) {
          const result = await wrapInnerCommand("locator.press", {
            locator: descriptor,
            key,
            holdMs: Number.isFinite(options.holdMs) ? Math.round(options.holdMs) : null,
          }, options);
          updatePageState(state, result);
          return result;
        },
        async hover(options = {}) {
          const result = await wrapInnerCommand("locator.hover", { locator: descriptor }, options);
          updatePageState(state, result);
          return result;
        },
        async getAttribute(name) {
          const result = await wrapInnerCommand("locator.getAttribute", {
            locator: descriptor,
            name: String(name ?? ""),
          });
          updatePageState(state, result);
          return result?.attributeValue ?? null;
        },
        async innerHTML() {
          const result = await wrapInnerCommand("locator.innerHTML", { locator: descriptor });
          updatePageState(state, result);
          return result?.innerHTML ?? null;
        },
        async inputValue() {
          const result = await wrapInnerCommand("locator.inputValue", { locator: descriptor });
          updatePageState(state, result);
          return result?.inputValue ?? null;
        },
        first() {
          return createFrameLocator(client, state, iframeSelector).locator(descriptor.selector).nth(0);
        },
        last() {
          const nthDescriptor = { ...descriptor, nth: "last" };
          const nthTarget = {
            async click(options = {}) {
              const result = await wrapInnerCommand("locator.click", { locator: nthDescriptor }, options);
              updatePageState(state, result);
              return result;
            },
            async selectOption(values, options = {}) {
              const result = await wrapInnerCommand(
                "locator.selectOption",
                {
                  locator: nthDescriptor,
                  values: normalizeSelectOptionValues(values),
                },
                options,
              );
              updatePageState(state, result);
              return result;
            },
            async textContent() {
              const result = await wrapInnerCommand("locator.textContent", { locator: nthDescriptor });
              updatePageState(state, result);
              return result?.textContent ?? null;
            },
            async isVisible() {
              const result = await wrapInnerCommand("locator.isVisible", { locator: nthDescriptor });
              updatePageState(state, result);
              return result?.visible === true;
            },
          };
          return createUnsupportedProxy("frameLocator.locator.last", nthTarget);
        },
        nth(index) {
          const nthDescriptor = { ...descriptor, nth: index };
          const nthTarget = {
            async click(options = {}) {
              const result = await wrapInnerCommand("locator.click", { locator: nthDescriptor }, options);
              updatePageState(state, result);
              return result;
            },
            async fill(value, options = {}) {
              const result = await wrapInnerCommand(
                "locator.fill",
                { locator: nthDescriptor, value: String(value ?? "") },
                options,
              );
              updatePageState(state, result);
              return result;
            },
            async selectOption(values, options = {}) {
              const result = await wrapInnerCommand(
                "locator.selectOption",
                {
                  locator: nthDescriptor,
                  values: normalizeSelectOptionValues(values),
                },
                options,
              );
              updatePageState(state, result);
              return result;
            },
            async textContent() {
              const result = await wrapInnerCommand("locator.textContent", { locator: nthDescriptor });
              updatePageState(state, result);
              return result?.textContent ?? null;
            },
            async isVisible() {
              const result = await wrapInnerCommand("locator.isVisible", { locator: nthDescriptor });
              updatePageState(state, result);
              return result?.visible === true;
            },
          };
          return createUnsupportedProxy("frameLocator.locator.nth", nthTarget);
        },
      };

      return createUnsupportedProxy("frameLocator.locator", locatorTarget);
    },
    getByText(text, options = {}) {
      const descriptor = { kind: "text", text: text.trim(), exact: options.exact === true };
      return this.locator(`text=${text}`); // Simplified - delegates to inner locator
    },
    getByRole(role, options = {}) {
      const descriptor = { kind: "role", role: role.trim(), name: options.name ?? null, exact: options.exact === true };

      const locatorTarget = {
        async click(options2 = {}) {
          const result = await wrapInnerCommand("locator.click", { locator: descriptor }, options2);
          updatePageState(state, result);
          return result;
        },
        async selectOption(values, options2 = {}) {
          const result = await wrapInnerCommand(
            "locator.selectOption",
            {
              locator: descriptor,
              values: normalizeSelectOptionValues(values),
            },
            options2,
          );
          updatePageState(state, result);
          return result;
        },
        async textContent() {
          const result = await wrapInnerCommand("locator.textContent", { locator: descriptor });
          updatePageState(state, result);
          return result?.textContent ?? null;
        },
        async isVisible() {
          const result = await wrapInnerCommand("locator.isVisible", { locator: descriptor });
          updatePageState(state, result);
          return result?.visible === true;
        },
      };

      return createUnsupportedProxy("frameLocator.getByRole", locatorTarget);
    },
  };

  return createUnsupportedProxy("frameLocator", frameLocatorTarget);
}

export function createPage(client, state) {
  const keyboard = createUnsupportedProxy("page.keyboard", {
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
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
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
      updatePageState(state, result);
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
      updatePageState(state, result);
      return result;
    },
    async type(text, options = {}) {
      const result = await client.send(
        "keyboard.type",
        {
          text: String(text ?? ""),
          delay: Number.isFinite(options.delay) ? Math.round(options.delay) : 0,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
  });

  const mouse = createUnsupportedProxy("page.mouse", {
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
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      state.mousePoint = { x, y };
      return result;
    },
    async move(x, y) {
      const result = await client.send("mouse.move", { x, y });
      updatePageState(state, result);
      state.mousePoint = { x, y };
      return result;
    },
    async down(options = {}) {
      const point = requireFinitePoint(
        Number.isFinite(options.x) && Number.isFinite(options.y)
          ? { x: options.x, y: options.y }
          : state.mousePoint,
        "page.mouse.down",
      );
      const result = await client.send("mouse.down", {
        x: point.x,
        y: point.y,
        button: options.button ?? "left",
      });
      updatePageState(state, result);
      state.mousePoint = point;
      return result;
    },
    async up(options = {}) {
      const point = requireFinitePoint(
        Number.isFinite(options.x) && Number.isFinite(options.y)
          ? { x: options.x, y: options.y }
          : state.mousePoint,
        "page.mouse.up",
      );
      const result = await client.send("mouse.up", {
        x: point.x,
        y: point.y,
        button: options.button ?? "left",
      });
      updatePageState(state, result);
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
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      if (to && Number.isFinite(to.x) && Number.isFinite(to.y)) {
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
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
  });

  const pageTarget = {
    async goto(url, options = {}) {
      const result = await client.send(
        "page.goto",
        {
          url,
          waitUntil: options.waitUntil ?? null,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async reload(options = {}) {
      const result = await client.send(
        "page.reload",
        {
          bypassCache: options.bypassCache === true,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    url() {
      return state.url ?? null;
    },
    async title() {
      const result = await client.send("page.title");
      updatePageState(state, result);
      return result?.title ?? null;
    },
    async screenshot(options = {}) {
      const result = await client.send(
        "page.screenshot",
        {
          selector: typeof options.selector === "string" ? options.selector : null,
          clip: normalizeClipRect(options.clip),
          fullPage: options.fullPage === true,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      const buffer = parseDataUrl(result?.screenshot?.dataUrl);
      writeScreenshotBuffer(buffer, options.path);
      return buffer;
    },
    async evaluate(fnOrExpression, arg) {
      const result = await client.send("page.evaluate", serializeEvaluateInput(fnOrExpression, arg));
      updatePageState(state, result);
      if (result?.fallbackUsed === true) {
        process.stderr.write(
          `[kuma-picker] page.evaluate fell back to ${result?.evaluateBackend ?? "content-script"} after debugger failure: ${
            typeof result?.fallbackReason === "string" ? result.fallbackReason : "unknown error"
          }\n`,
        );
      }
      return result?.value ?? null;
    },
    locator(selector) {
      if (typeof selector !== "string" || !selector.trim()) {
        throw new Error("page.locator requires a non-empty selector.");
      }
      return createLocator(client, state, createLocatorDescriptor("selector", { selector: selector.trim() }));
    },
    getByText(text, options = {}) {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("page.getByText requires a non-empty text value.");
      }
      return createLocator(
        client,
        state,
        createLocatorDescriptor("text", {
          text: text.trim(),
          exact: options.exact === true,
        }),
      );
    },
    getByRole(role, options = {}) {
      if (typeof role !== "string" || !role.trim()) {
        throw new Error("page.getByRole requires a non-empty role.");
      }
      return createLocator(
        client,
        state,
        createLocatorDescriptor("role", {
          role: role.trim(),
          name: typeof options.name === "string" && options.name.trim() ? options.name.trim() : null,
          exact: options.exact === true,
        }),
      );
    },
    getByLabel(text, options = {}) {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("page.getByLabel requires a non-empty label.");
      }
      return createLocator(
        client,
        state,
        createLocatorDescriptor("label", {
          text: text.trim(),
          exact: options.exact === true,
        }),
      );
    },
    async goBack(options = {}) {
      const result = await client.send(
        "page.goBack",
        {},
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async goForward(options = {}) {
      const result = await client.send(
        "page.goForward",
        {},
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    getByPlaceholder(text, options = {}) {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("page.getByPlaceholder requires a non-empty placeholder text.");
      }
      return createLocator(
        client,
        state,
        createLocatorDescriptor("placeholder", {
          text: text.trim(),
          exact: options.exact === true,
        }),
      );
    },
    getByTestId(testId) {
      if (typeof testId !== "string" || !testId.trim()) {
        throw new Error("page.getByTestId requires a non-empty test ID.");
      }
      return createLocator(
        client,
        state,
        createLocatorDescriptor("testid", {
          testId: testId.trim(),
        }),
      );
    },
    async waitForSelector(selector, options = {}) {
      if (typeof selector !== "string" || !selector.trim()) {
        throw new Error("page.waitForSelector requires a non-empty selector.");
      }
      const result = await client.send(
        "page.waitForSelector",
        {
          selector: selector.trim(),
          state: options.state ?? "visible",
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async waitForLoadState(loadState = "load", options = {}) {
      const validStates = ["load", "domcontentloaded", "networkidle"];
      if (!validStates.includes(loadState)) {
        throw new Error(`page.waitForLoadState: invalid state "${loadState}". Use one of: ${validStates.join(", ")}`);
      }
      const result = await client.send(
        "page.waitForLoadState",
        {
          state: loadState,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    frame(selector) {
      if (typeof selector !== "string" || !selector.trim()) {
        throw new Error("page.frame requires a non-empty iframe selector.");
      }
      return createFrameHandle(client, state, selector.trim());
    },
    frameLocator(selector) {
      if (typeof selector !== "string" || !selector.trim()) {
        throw new Error("page.frameLocator requires a non-empty iframe selector.");
      }
      return createFrameLocator(client, state, selector.trim());
    },
    async hoverAndClick(hoverSelector, clickSelector, waitMs = 500, options = {}) {
      if (typeof hoverSelector !== "string" || !hoverSelector.trim()) {
        throw new Error("page.hoverAndClick requires a non-empty hoverSelector.");
      }
      if (typeof clickSelector !== "string" || !clickSelector.trim()) {
        throw new Error("page.hoverAndClick requires a non-empty clickSelector.");
      }
      const result = await client.send(
        "page.hoverAndClick",
        {
          hoverSelector: hoverSelector.trim(),
          clickSelector: clickSelector.trim(),
          waitMs: Number.isFinite(waitMs) ? Math.round(waitMs) : 500,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async dragAndDrop(source, target, options = {}) {
      if (typeof source !== "string" || !source.trim()) {
        throw new Error("page.dragAndDrop requires a non-empty source selector.");
      }
      if (typeof target !== "string" || !target.trim()) {
        throw new Error("page.dragAndDrop requires a non-empty target selector.");
      }
      const result = await client.send(
        "page.dragAndDrop",
        {
          source: source.trim(),
          target: target.trim(),
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      return result;
    },
    async route(urlPattern, handler) {
      if (!urlPattern) {
        throw new Error("page.route requires a URL pattern.");
      }
      let routeHandler;
      if (typeof handler === "function") {
        const routeApi = {};
        const routePromise = new Promise((resolve) => {
          routeApi.fulfill = (opts) => resolve({ fulfill: opts });
          routeApi.abort = () => resolve({ abort: true });
        });
        handler(routeApi);
        routeHandler = await routePromise;
      } else {
        routeHandler = handler ?? {};
      }
      const result = await client.send(
        "page.route",
        {
          urlPattern: typeof urlPattern === "string" ? urlPattern : String(urlPattern),
          handler: routeHandler,
        },
      );
      updatePageState(state, result);
      return result;
    },
    async unroute(urlPattern) {
      const result = await client.send(
        "page.unroute",
        {
          urlPattern: urlPattern ? (typeof urlPattern === "string" ? urlPattern : String(urlPattern)) : null,
        },
      );
      updatePageState(state, result);
      return result;
    },
    keyboard,
    mouse,
  };

  return createUnsupportedProxy("page", pageTarget);
}
