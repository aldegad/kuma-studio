import { enqueueBrowserCommand } from "./browser-command-client.mjs";
import { printJson } from "./browser-cli-output.mjs";
import { readNumber, readOptionalString } from "./cli-options.mjs";
import { readRequiredLocalFilePaths } from "./browser-cli-shared.mjs";

export async function commandBrowserSetFiles(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");

  if (!selector && !selectorPath) {
    throw new Error("browser-set-files requires --selector or --selector-path.");
  }

  const result = await enqueueBrowserCommand(options, {
    type: "set-files",
    selector,
    selectorPath,
    files: readRequiredLocalFilePaths(options),
    postActionDelayMs: readNumber(options, "post-action-delay-ms", 100),
  });
  printJson(result.result ?? null);
}
