import { readFile } from "node:fs/promises";
import path from "node:path";

import { AutomationClient, getDaemonUrlFromOptions, requireTarget } from "./automation-client.mjs";
import { readNumber } from "./cli-options.mjs";
import { createPage, createPageState } from "./playwright-page-facade.mjs";
import { AsyncFunction, createScriptConsole } from "./playwright-runner-support.mjs";

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

function detectScriptPattern(source) {
  if (/\bmodule\s*\.\s*exports\b/.test(source)) {
    return "commonjs";
  }

  if (
    /\bexport\s+default\b/.test(source) ||
    /\bexport\s+(?:async\s+)?function\b/.test(source) ||
    /\bexport\s*\{/.test(source)
  ) {
    return "esm";
  }

  return "top-level";
}

function stripEsmExports(source) {
  return source
    .replace(/\bexport\s+default\s+/g, "__default_export__ = ")
    .replace(/\bexport\s+(?=async\s+function|function|const|let|var|class)/g, "")
    .replace(/\bexport\s*\{[^}]*\}\s*;?/g, "");
}

export async function commandRunSource(options, scriptSource) {
  const resolvedSource = validateScriptSource(scriptSource);
  const targets = requireTarget(options);
  const state = createPageState();
  const client = new AutomationClient({
    daemonUrl: getDaemonUrlFromOptions(options),
    targets,
    defaultTimeoutMs: readNumber(options, "timeout-ms", 15_000),
  });
  const page = createPage(client, state);
  const scriptConsole = createScriptConsole();
  const scriptPattern = detectScriptPattern(resolvedSource);

  try {
    if (scriptPattern === "commonjs") {
      const moduleObj = { exports: {} };
      const executor = new AsyncFunction(
        "page",
        "console",
        "module",
        "exports",
        `"use strict";
${resolvedSource}
const __exported = module.exports;
const __run = typeof __exported === "function" ? __exported : __exported?.run;
if (typeof __run === "function") {
  await __run({ page });
}
`,
      );
      await executor(page, scriptConsole, moduleObj, moduleObj.exports);
      return;
    }

    if (scriptPattern === "esm") {
      const strippedSource = stripEsmExports(resolvedSource);
      const executor = new AsyncFunction(
        "page",
        "console",
        `"use strict";
let __default_export__;
${strippedSource}
const __run = typeof run === "function" ? run : __default_export__;
if (typeof __run === "function") {
  await __run({ page });
}
`,
      );
      await executor(page, scriptConsole);
      return;
    }

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
