import { enqueueBrowserCommand } from "./browser-command-client.mjs";
import { printJson } from "./browser-cli-output.mjs";
import { readNumber, readOptionalString } from "./cli-options.mjs";

const MAX_VISIBLE_TAB_RECORDING_FPS = 2;
const DEFAULT_RECORDING_FPS = 2;
const DEFAULT_RECORDING_SPEED_MULTIPLIER = 3;

export async function commandBrowserRecordStart(options) {
  const fps = readNumber(options, "fps", DEFAULT_RECORDING_FPS);
  if (!Number.isInteger(fps) || fps < 1) {
    throw new Error("browser-record-start --fps must be a positive integer.");
  }
  if (fps > MAX_VISIBLE_TAB_RECORDING_FPS) {
    throw new Error(
      `browser-record-start currently supports up to ${MAX_VISIBLE_TAB_RECORDING_FPS}fps because Chrome limits captureVisibleTab call rate.`,
    );
  }

  const speedMultiplier = readNumber(options, "speed-multiplier", DEFAULT_RECORDING_SPEED_MULTIPLIER);
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new Error("browser-record-start --speed-multiplier must be a positive number.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "record-start",
    fps,
    speedMultiplier,
    filename: readOptionalString(options, "filename"),
    focusTabFirst: options["focus-tab-first"] !== false,
    restorePreviousActiveTab: options["restore-previous-active-tab"] === true,
  });
  printJson(result.result ?? null);
}

export async function commandBrowserRecordStop(options) {
  const result = await enqueueBrowserCommand(options, {
    type: "record-stop",
  });
  printJson(result.result ?? null);
}
