import { enqueueBrowserCommand, fetchJson, getDaemonUrlFromOptions } from "./browser-command-client.mjs";
import { printJson, printScreenshotResult } from "./browser-cli-output.mjs";
export { commandBrowserSetFiles } from "./browser-cli-files.mjs";
export {
  commandBrowserLiveCaptureState,
  commandBrowserLiveCaptureStop,
  commandBrowserRecordStart,
  commandBrowserRecordStop,
} from "./browser-cli-recording.mjs";
import { readBrowserSequenceSteps } from "./browser-sequence.mjs";
import { readKeyboardModifierFlags } from "./browser-cli-shared.mjs";
import { readNumber, readOptionalString, requireString } from "./cli-options.mjs";

export async function commandGetBrowserSession(options) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const session = await fetchJson(`${daemonUrl}/browser-session`, {
    method: "GET",
    headers: {},
  });
  printJson(session);
}

export async function commandBrowserContext(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "context",
  });
  printJson(result.result ?? null);
}

export async function commandBrowserNavigate(options) {
  const navigationUrl = readOptionalString(options, "url");
  if (!navigationUrl) {
    throw new Error("browser-navigate requires --url.");
  }

  const result = await enqueueBrowserCommand(
    {
      ...options,
      url: undefined,
      "url-contains": undefined,
    },
    {
      type: "navigate",
      navigationUrl,
      newTab: options["new-tab"] === true,
      active: options["background"] !== true,
    },
    { allowUntargeted: true },
  );
  printJson(result.result ?? null);
}

export async function commandBrowserDom(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "dom",
  });
  printJson(result.result ?? null);
}

export async function commandBrowserEval(options) {
  const expression = readOptionalString(options, "expression");
  if (!expression) {
    throw new Error("browser-eval requires --expression.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "eval",
    expression,
    text: expression,
    value: expression,
  });
  printJson(result.result ?? null);
}

export async function commandBrowserConsole(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "console",
  });
  printJson(result.result ?? null);
}

export async function commandBrowserDebuggerCapture(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "debugger-capture",
    refreshBeforeCapture: options["refresh"] === true,
    bypassCache: options["bypass-cache"] === true,
    captureMs: readNumber(options, "capture-ms", 3_000),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserClick(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const text = readOptionalString(options, "text");
  const role = readOptionalString(options, "role");
  const within = readOptionalString(options, "within");
  const nth = readNumber(options, "nth", null);
  const exactText = options["exact-text"] === true;

  if (!selector && !selectorPath && !text) {
    throw new Error("browser-click requires --selector, --selector-path, or --text.");
  }

  if (nth != null && (!Number.isInteger(nth) || nth < 1)) {
    throw new Error("browser-click --nth must be a positive integer.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "click",
    selector,
    selectorPath,
    text,
    role,
    within,
    nth,
    exactText,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 400),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserSequence(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "sequence",
    steps: readBrowserSequenceSteps(options),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserClickPoint(options) {
  const x = readNumber(options, "x", null);
  const y = readNumber(options, "y", null);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("browser-click-point requires --x and --y.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "click-point",
    x,
    y,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 400),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserPointerDrag(options) {
  const fromX = readNumber(options, "from-x", null);
  const fromY = readNumber(options, "from-y", null);
  const toX = readNumber(options, "to-x", null);
  const toY = readNumber(options, "to-y", null);
  const waypointsJson = readOptionalString(options, "waypoints");

  let waypoints = null;
  if (waypointsJson) {
    try {
      waypoints = JSON.parse(waypointsJson);
    } catch (error) {
      throw new Error(`Failed to parse --waypoints JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      throw new Error("--waypoints must be a JSON array with at least 2 points.");
    }
  } else if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX) || !Number.isFinite(toY)) {
    throw new Error("browser-pointer-drag requires (--from-x, --from-y, --to-x, --to-y) or --waypoints.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "pointer-drag",
    ...(waypoints ? { waypoints } : { fromX, fromY, toX, toY }),
    durationMs: readNumber(options, "duration-ms", 500),
    steps: readNumber(options, "steps", null),
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 0),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserFill(options) {
  const value = typeof options.value === "string" ? options.value : null;
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const label = readOptionalString(options, "label");
  const text = readOptionalString(options, "text");
  const scope = readOptionalString(options, "scope");

  if (value == null) {
    throw new Error("browser-fill requires --value.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "fill",
    value,
    selector,
    selectorPath,
    label,
    text,
    scope,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 100),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserKey(options) {
  const key = readOptionalString(options, "key");
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const text = readOptionalString(options, "text");

  if (!key) {
    throw new Error("browser-key requires --key.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "key",
    key,
    selector,
    selectorPath,
    text,
    ...readKeyboardModifierFlags(options),
    holdMs: readNumber(options, "hold-ms", null),
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 100),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserKeyDown(options) {
  const key = readOptionalString(options, "key");
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const text = readOptionalString(options, "text");

  if (!key) {
    throw new Error("browser-keydown requires --key.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "keydown",
    key,
    selector,
    selectorPath,
    text,
    ...readKeyboardModifierFlags(options),
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 0),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserKeyUp(options) {
  const key = readOptionalString(options, "key");
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const text = readOptionalString(options, "text");

  if (!key) {
    throw new Error("browser-keyup requires --key.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "keyup",
    key,
    selector,
    selectorPath,
    text,
    ...readKeyboardModifierFlags(options),
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 0),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserMouseMove(options) {
  const x = readNumber(options, "x", null);
  const y = readNumber(options, "y", null);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("browser-mousemove requires --x and --y.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "mousemove",
    x,
    y,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 0),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserMouseDown(options) {
  const x = readNumber(options, "x", null);
  const y = readNumber(options, "y", null);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("browser-mousedown requires --x and --y.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "mousedown",
    x,
    y,
    button: readOptionalString(options, "button"),
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 0),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserMouseUp(options) {
  const x = readNumber(options, "x", null);
  const y = readNumber(options, "y", null);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("browser-mouseup requires --x and --y.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "mouseup",
    x,
    y,
    button: readOptionalString(options, "button"),
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 0),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserRefresh(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "refresh",
    bypassCache: options["bypass-cache"] === true,
  });
  printJson(result.result ?? null);
}

export async function commandBrowserWaitForText(options) {
  const text = readOptionalString(options, "text");
  if (!text) {
    throw new Error("browser-wait-for-text requires --text.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-text",
    text,
    scope: readOptionalString(options, "scope"),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserWaitForDownload(options) {
  const filenameContains = readOptionalString(options, "filename-contains");
  const downloadUrlContains = readOptionalString(options, "download-url-contains");

  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-download",
    filenameContains,
    downloadUrlContains,
  });
  printJson(result.result ?? null);
}

export async function commandBrowserGetLatestDownload(options) {
  const filenameContains = readOptionalString(options, "filename-contains");
  const downloadUrlContains = readOptionalString(options, "download-url-contains");

  const result = await enqueueBrowserCommand(options, {
    type: "get-latest-download",
    filenameContains,
    downloadUrlContains,
  });
  printJson(result.result ?? null);
}

export async function commandBrowserDownloadPermission(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "download-permission",
  });
  printJson(result.result ?? null);
}

export async function commandBrowserWaitForTextDisappear(options) {
  const text = readOptionalString(options, "text");
  if (!text) {
    throw new Error("browser-wait-for-text-disappear requires --text.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-text-disappear",
    text,
    scope: readOptionalString(options, "scope"),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserWaitForSelector(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");

  if (!selector && !selectorPath) {
    throw new Error("browser-wait-for-selector requires --selector or --selector-path.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-selector",
    selector,
    selectorPath,
    scope: readOptionalString(options, "scope"),
  });
  printJson(result.result ?? null);
}

export async function commandBrowserWaitForDialogClose(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "wait-for-dialog-close",
  });
  printJson(result.result ?? null);
}

export async function commandBrowserQueryDom(options) {
  const kind = readOptionalString(options, "kind");
  const text = readOptionalString(options, "text");
  const scope = readOptionalString(options, "scope");
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");

  if (!kind) {
    throw new Error("browser-query-dom requires --kind.");
  }

  if ((kind === "nearby-input" || kind === "input-by-label" || kind === "menu-state" || kind === "selected-option" || kind === "tab-state") && !text) {
    throw new Error(`browser-query-dom --kind ${kind} requires --text.`);
  }
  if (kind === "selector-state" && !selector && !selectorPath) {
    throw new Error("browser-query-dom --kind selector-state requires --selector or --selector-path.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "query-dom",
    kind,
    text,
    scope,
    selector,
    selectorPath,
  });
  printJson(result.result ?? null);
}

export async function commandBrowserScreenshot(options) {
  const file = requireString(options, "file");
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const scope = readOptionalString(options, "scope");
  const x = readNumber(options, "x", null);
  const y = readNumber(options, "y", null);
  const width = readNumber(options, "width", null);
  const height = readNumber(options, "height", null);
  const hasClipRect = [x, y, width, height].every((value) => Number.isFinite(value));

  if ([x, y, width, height].some((value) => value != null) && !hasClipRect) {
    throw new Error("browser-screenshot clip mode requires --x, --y, --width, and --height together.");
  }

  if (hasClipRect && (width < 1 || height < 1)) {
    throw new Error("browser-screenshot clip width and height must be positive.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "screenshot",
    focusTabFirst: options["focus-tab-first"] !== false,
    restorePreviousActiveTab: options["restore-previous-active-tab"] === true,
    selector,
    selectorPath,
    scope,
    clipRect: hasClipRect ? { x, y, width, height } : null,
  });
  printScreenshotResult(file, result.result ?? null);
}
