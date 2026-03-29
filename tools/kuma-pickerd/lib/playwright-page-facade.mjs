import { writeFileSync } from "node:fs";
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
  };

  return createUnsupportedProxy("locator", locatorTarget);
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
    keyboard,
    mouse,
  };

  return createUnsupportedProxy("page", pageTarget);
}
