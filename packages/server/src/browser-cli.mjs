import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { AutomationClient, fetchJson, getDaemonUrlFromOptions, readTargetOptions } from "./automation-client.mjs";
import { readNumber, readOptionalString } from "./cli-options.mjs";

const DEFAULT_BROWSER_SCREENSHOT_PATH = "/tmp/kuma-studio-screenshot.png";

export async function commandGetBrowserSession(options) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const session = await fetchJson(`${daemonUrl}/browser-session`, {
    method: "GET",
    headers: {},
  });
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}

function decodeScreenshotBase64(result) {
  const screenshot = result?.screenshot ?? result ?? null;
  if (typeof screenshot?.base64 === "string" && screenshot.base64) {
    return {
      base64: screenshot.base64,
      mimeType: screenshot.mimeType ?? "image/png",
      capturedAt: screenshot.capturedAt ?? null,
      page: result?.page ?? null,
      tabId: screenshot.tabId ?? result?.tabId ?? null,
      windowId: screenshot.windowId ?? result?.windowId ?? null,
    };
  }

  const dataUrl = typeof screenshot?.dataUrl === "string" ? screenshot.dataUrl : null;
  const matched = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl ?? "");
  if (!matched) {
    throw new Error("Screenshot result did not include base64 image data.");
  }

  return {
    base64: matched[2],
    mimeType: matched[1] || "image/png",
    capturedAt: screenshot?.capturedAt ?? null,
    page: result?.page ?? null,
    tabId: screenshot?.tabId ?? result?.tabId ?? null,
    windowId: screenshot?.windowId ?? result?.windowId ?? null,
  };
}

export async function commandBrowserScreenshot(options) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = readTargetOptions(options);
  const timeoutMs = readNumber(options, "timeout-ms", 15_000);
  const rawFilePath = readOptionalString(options, "file") ?? DEFAULT_BROWSER_SCREENSHOT_PATH;
  const filePath = path.resolve(rawFilePath);
  const client = new AutomationClient({
    daemonUrl,
    targets,
    defaultTimeoutMs: timeoutMs,
  });

  try {
    const result = await client.sendCommand({
      type: "screenshot",
      timeoutMs,
      ...targets,
    });
    const screenshot = decodeScreenshotBase64(result);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(screenshot.base64, "base64"));
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          file: filePath,
          mimeType: screenshot.mimeType,
          capturedAt: screenshot.capturedAt,
          tabId: screenshot.tabId,
          windowId: screenshot.windowId,
          page: screenshot.page,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}
