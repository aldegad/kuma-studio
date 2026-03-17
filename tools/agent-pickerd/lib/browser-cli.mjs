import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readNumber, readOptionalString, requireString } from "./cli-options.mjs";

function normalizeDaemonUrl(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  return (trimmed || "http://127.0.0.1:4312").replace(/\/+$/, "");
}

function getDaemonUrlFromOptions(options) {
  return normalizeDaemonUrl(options["daemon-url"]);
}

function readCommandTargetOptions(options) {
  const tabId = readNumber(options, "tab-id", null);
  const targetUrl = readOptionalString(options, "url");
  const targetUrlContains = readOptionalString(options, "url-contains");

  return {
    targetTabId: Number.isInteger(tabId) ? tabId : null,
    targetUrl,
    targetUrlContains,
  };
}

async function fetchJson(endpoint, init = {}, { allowNoContent = false } = {}) {
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (allowNoContent && response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Request failed with status ${response.status}.`);
  }

  return response.json();
}

async function enqueueBrowserCommand(options, payload) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const pollIntervalMs = 250;
  const startedAt = Date.now();
  const command = await fetchJson(`${daemonUrl}/browser-session/commands`, {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      ...readCommandTargetOptions(options),
      timeoutMs,
    }),
  });

  while (Date.now() - startedAt <= timeoutMs) {
    const result = await fetchJson(`${daemonUrl}/browser-session/commands/${command.id}`, {
      method: "GET",
      headers: {},
    });

    if (result?.status === "completed" || result?.status === "failed") {
      if (result.status === "failed") {
        throw new Error(result.error || "Browser command failed.");
      }

      return result;
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, pollIntervalMs);
    });
  }

  throw new Error(
    `Timed out waiting for the browser command result after ${timeoutMs}ms. Keep the target tab active and focused so the extension can poll commands.`,
  );
}

function writeScreenshotFile(filePath, dataUrl) {
  const match = typeof dataUrl === "string" ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
  if (!match) {
    throw new Error("The browser screenshot result did not include a PNG data URL.");
  }

  writeFileSync(resolve(filePath), Buffer.from(match[2], "base64"));
}

export async function commandGetBrowserSession(options) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const session = await fetchJson(`${daemonUrl}/browser-session`, {
    method: "GET",
    headers: {},
  });
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}

export async function commandBrowserContext(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "context",
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserDom(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "dom",
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserClick(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const text = readOptionalString(options, "text");

  if (!selector && !selectorPath && !text) {
    throw new Error("browser-click requires --selector, --selector-path, or --text.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "click",
    selector,
    selectorPath,
    text,
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 400),
  });
  process.stdout.write(`${JSON.stringify(result.result ?? null, null, 2)}\n`);
}

export async function commandBrowserScreenshot(options) {
  const file = requireString(options, "file");
  const result = await enqueueBrowserCommand(options, {
    type: "screenshot",
  });
  const screenshot = result.result?.screenshot ?? null;

  if (!screenshot?.dataUrl) {
    throw new Error("The browser screenshot result did not include image data.");
  }

  writeScreenshotFile(file, screenshot.dataUrl);
  process.stdout.write(
    `${JSON.stringify(
      {
        file: resolve(file),
        page: result.result?.page ?? null,
        width: screenshot.width ?? 0,
        height: screenshot.height ?? 0,
        capturedAt: screenshot.capturedAt ?? null,
      },
      null,
      2,
    )}\n`,
  );
}
