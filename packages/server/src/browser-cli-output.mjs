import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeScreenshotFile(filePath, dataUrl) {
  const match = typeof dataUrl === "string" ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
  if (!match) {
    throw new Error("The browser screenshot result did not include a PNG data URL.");
  }

  const resolvedFilePath = resolve(filePath);
  mkdirSync(dirname(resolvedFilePath), { recursive: true });
  writeFileSync(resolvedFilePath, Buffer.from(match[2], "base64"));
}

export function printScreenshotResult(file, result) {
  const screenshot = result?.screenshot ?? null;
  const capture = result?.capture ?? null;
  const clip = result?.clip ?? null;

  if (!screenshot?.dataUrl) {
    throw new Error("The browser screenshot result did not include image data.");
  }

  writeScreenshotFile(file, screenshot.dataUrl);
  printJson({
    file: resolve(file),
    page: result?.page ?? null,
    width: screenshot.width ?? 0,
    height: screenshot.height ?? 0,
    capturedAt: screenshot.capturedAt ?? null,
    capturedTabId: capture?.tabId ?? null,
    capturedWindowId: capture?.windowId ?? null,
    focused: capture?.focused ?? null,
    active: capture?.active ?? null,
    clip,
  });
}
