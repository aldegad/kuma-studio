import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import util from "node:util";

import { AutomationClient, getDaemonUrlFromOptions, requireTarget } from "./automation-client.mjs";
import { readNumber } from "./cli-options.mjs";

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

function formatConsoleArgs(args) {
  return args
    .map((arg) =>
      typeof arg === "string"
        ? arg
        : util.inspect(arg, {
            colors: false,
            depth: 6,
            compact: 3,
            breakLength: Infinity,
          }),
    )
    .join(" ");
}

function createScriptConsole() {
  return {
    log: (...args) => {
      process.stdout.write(`${formatConsoleArgs(args)}\n`);
    },
    info: (...args) => {
      process.stdout.write(`${formatConsoleArgs(args)}\n`);
    },
    warn: (...args) => {
      process.stderr.write(`${formatConsoleArgs(args)}\n`);
    },
    error: (...args) => {
      process.stderr.write(`${formatConsoleArgs(args)}\n`);
    },
  };
}

function createUnsupportedProxy(label, target) {
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

function serializeEvaluateInput(fnOrExpression, arg) {
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

function parseDataUrl(dataUrl) {
  const matched = /^data:([^;]+);base64,(.+)$/u.exec(String(dataUrl ?? ""));
  if (!matched) {
    throw new Error("Screenshot result did not include a valid data URL.");
  }

  return Buffer.from(matched[2], "base64");
}

function toAbsolutePath(filePath) {
  return path.resolve(process.cwd(), filePath);
}

function updatePageState(state, payload) {
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

function createLocatorDescriptor(kind, fields) {
  return { kind, ...fields };
}

async function readScriptSource(fileArg) {
  if (typeof fileArg === "string" && fileArg.trim()) {
    return readFile(path.resolve(process.cwd(), fileArg), "utf8");
  }

  if (process.stdin.isTTY) {
    throw new Error("The run command expects a script file path or stdin input.");
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const source = Buffer.concat(chunks).toString("utf8");
  if (!source.trim()) {
    throw new Error("The run command received an empty script.");
  }

  return source;
}

function validateScriptSource(scriptSource) {
  if (typeof scriptSource !== "string" || !scriptSource.trim()) {
    throw new Error("The run command received an empty script.");
  }

  return scriptSource;
}

function createLocator(client, state, descriptor) {
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
      const result = await client.send("page.screenshot", {
        clip: measurement?.rect ?? null,
      });
      updatePageState(state, result);
      const buffer = parseDataUrl(result?.screenshot?.dataUrl);
      if (typeof options.path === "string" && options.path.trim()) {
        writeFileSync(toAbsolutePath(options.path), buffer);
      }
      return buffer;
    },
  };

  return createUnsupportedProxy("locator", locatorTarget);
}

function createPage(client, state) {
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
    async move(x, y) {
      const result = await client.send("mouse.move", { x, y });
      updatePageState(state, result);
      state.mousePoint = { x, y };
      return result;
    },
    async down(options = {}) {
      const point = {
        x: Number.isFinite(options.x) ? options.x : state.mousePoint?.x,
        y: Number.isFinite(options.y) ? options.y : state.mousePoint?.y,
      };
      const result = await client.send("mouse.down", {
        x: point.x,
        y: point.y,
        button: options.button ?? "left",
      });
      updatePageState(state, result);
      state.mousePoint = Number.isFinite(point.x) && Number.isFinite(point.y) ? point : state.mousePoint;
      return result;
    },
    async up(options = {}) {
      const point = {
        x: Number.isFinite(options.x) ? options.x : state.mousePoint?.x,
        y: Number.isFinite(options.y) ? options.y : state.mousePoint?.y,
      };
      const result = await client.send("mouse.up", {
        x: point.x,
        y: point.y,
        button: options.button ?? "left",
      });
      updatePageState(state, result);
      state.mousePoint = Number.isFinite(point.x) && Number.isFinite(point.y) ? point : state.mousePoint;
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
          clip:
            options.clip &&
            typeof options.clip === "object" &&
            Number.isFinite(options.clip.x) &&
            Number.isFinite(options.clip.y) &&
            Number.isFinite(options.clip.width) &&
            Number.isFinite(options.clip.height)
              ? {
                  x: options.clip.x,
                  y: options.clip.y,
                  width: options.clip.width,
                  height: options.clip.height,
                }
              : null,
        },
        { timeoutMs: options.timeout },
      );
      updatePageState(state, result);
      const buffer = parseDataUrl(result?.screenshot?.dataUrl);
      if (typeof options.path === "string" && options.path.trim()) {
        writeFileSync(toAbsolutePath(options.path), buffer);
      }
      return buffer;
    },
    async evaluate(fnOrExpression, arg) {
      const result = await client.send("page.evaluate", serializeEvaluateInput(fnOrExpression, arg));
      updatePageState(state, result);
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

export async function commandRunSource(options, scriptSource) {
  const resolvedSource = validateScriptSource(scriptSource);
  const targets = requireTarget(options);
  const state = {
    url: targets.targetUrl ?? null,
    pathname: null,
    title: null,
    mousePoint: null,
  };
  const client = new AutomationClient({
    daemonUrl: getDaemonUrlFromOptions(options),
    targets,
    defaultTimeoutMs: readNumber(options, "timeout-ms", 15_000),
  });
  const page = createPage(client, state);
  const scriptConsole = createScriptConsole();

  try {
    const executor = new AsyncFunction(
      "page",
      "console",
      `"use strict"; return (async () => {\n${resolvedSource}\n})();`,
    );
    await executor(page, scriptConsole);
  } finally {
    await client.close();
  }
}

export async function commandRun(options, fileArg = null) {
  return commandRunSource(options, await readScriptSource(fileArg));
}
