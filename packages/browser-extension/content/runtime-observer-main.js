(() => {
  const KUMA_PICKER_RUNTIME_SOURCE = "kuma-picker:runtime-observer";

  if (window.__kumaPickerRuntimeObserverInstalled === true) {
    return;
  }
  window.__kumaPickerRuntimeObserverInstalled = true;

  function normalizeString(value, maxLength = 400) {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
  }

  function summarizeValue(value, depth = 0, seen = new WeakSet()) {
    if (value == null) {
      return value;
    }

    if (typeof value === "string") {
      return normalizeString(value, 600) ?? "";
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "bigint") {
      return String(value);
    }

    if (typeof value === "function") {
      return `[Function ${value.name || "anonymous"}]`;
    }

    if (value instanceof Error) {
      return {
        name: value.name || "Error",
        message: normalizeString(value.message, 600) ?? "",
        stack: normalizeString(value.stack, 1_500),
      };
    }

    if (typeof Node !== "undefined" && value instanceof Node) {
      if (value instanceof Element) {
        return {
          nodeType: value.tagName.toLowerCase(),
          id: value.id || null,
          className: typeof value.className === "string" ? normalizeString(value.className, 200) : null,
          text: normalizeString(value.textContent, 200),
        };
      }

      return {
        nodeType: value.nodeName,
      };
    }

    if (typeof value === "object") {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);

      if (Array.isArray(value)) {
        if (depth >= 2) {
          return `[Array(${value.length})]`;
        }
        return value.slice(0, 8).map((entry) => summarizeValue(entry, depth + 1, seen));
      }

      const tagName = Object.prototype.toString.call(value);
      if (depth >= 2) {
        return tagName;
      }

      const summary = {};
      for (const [key, entry] of Object.entries(value).slice(0, 8)) {
        summary[key] = summarizeValue(entry, depth + 1, seen);
      }
      summary.__tag = tagName;
      return summary;
    }

    return String(value);
  }

  function summarizeArgs(args) {
    return args.map((entry) => summarizeValue(entry));
  }

  function formatSummary(value) {
    if (value == null) {
      return String(value);
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value === "object") {
      if (typeof value.message === "string" && value.message) {
        return value.message;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return Object.prototype.toString.call(value);
      }
    }

    return String(value);
  }

  function publishEntry(entry) {
    try {
      window.postMessage(
        {
          source: KUMA_PICKER_RUNTIME_SOURCE,
          entry,
        },
        "*",
      );
    } catch {
      // Ignore clone failures from unexpected values.
    }
  }

  function createBaseEntry(type, level, extra = {}) {
    return {
      type,
      level,
      timestamp: new Date().toISOString(),
      ...extra,
    };
  }

  for (const level of ["log", "info", "warn", "error", "debug"]) {
    if (typeof console[level] !== "function") {
      continue;
    }

    const original = console[level];
    console[level] = function kumaPickerConsoleProxy(...args) {
      const summarizedArgs = summarizeArgs(args);
      publishEntry(
        createBaseEntry("console", level, {
          message: normalizeString(summarizedArgs.map(formatSummary).join(" "), 1_500),
          args: summarizedArgs,
        }),
      );
      return original.apply(this, args);
    };
  }

  window.addEventListener("error", (event) => {
    publishEntry(
      createBaseEntry("error", "error", {
        message: normalizeString(event.message, 1_500),
        filename: normalizeString(event.filename, 1_000),
        lineno: Number.isFinite(event.lineno) ? event.lineno : null,
        colno: Number.isFinite(event.colno) ? event.colno : null,
        error: summarizeValue(event.error),
      }),
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = summarizeValue(event.reason);
    publishEntry(
      createBaseEntry("unhandledrejection", "error", {
        message: normalizeString(formatSummary(reason), 1_500),
        reason,
      }),
    );
  });
})();
