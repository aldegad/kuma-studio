import util from "node:util";

export const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

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

export function createScriptConsole() {
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

export function createUnsupportedProxy(label, target) {
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

export function serializeEvaluateInput(fnOrExpression, arg) {
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

export function parseDataUrl(dataUrl) {
  const matched = /^data:([^;]+);base64,(.+)$/u.exec(String(dataUrl ?? ""));
  if (!matched) {
    throw new Error("Screenshot result did not include a valid data URL.");
  }

  return Buffer.from(matched[2], "base64");
}
