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
