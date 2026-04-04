import { readFile } from "node:fs/promises";
import path from "node:path";
import util from "node:util";

import { AutomationClient, getDaemonUrlFromOptions, requireTarget } from "./automation-client.mjs";
import { runWithBrowserAutoRecovery } from "./browser-auto-recovery.mjs";
import { readNumber } from "./cli-options.mjs";

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

function formatRunLogLine(entry) {
  if (typeof entry?.message === "string" && entry.message) {
    return entry.message;
  }

  const values = Array.isArray(entry?.values) ? entry.values : [];
  if (values.length === 0) {
    return "";
  }

  return values
    .map((value) =>
      typeof value === "string"
        ? value
        : util.inspect(value, {
            colors: false,
            depth: 6,
            compact: 3,
            breakLength: Infinity,
          }),
    )
    .join(" ");
}

export async function commandRunSource(options, scriptSource) {
  const resolvedSource = validateScriptSource(scriptSource);
  const daemonUrl = getDaemonUrlFromOptions(options);
  const targets = requireTarget(options);
  const client = new AutomationClient({
    daemonUrl,
    targets,
    defaultTimeoutMs: readNumber(options, "timeout-ms", 15_000),
  });

  try {
    const result = await runWithBrowserAutoRecovery({
      daemonUrl,
      targets,
      execute: () =>
        client.send("script.run", {
          source: resolvedSource,
        }),
    });

    const logs = Array.isArray(result?.logs) ? result.logs : [];
    for (const entry of logs) {
      const line = formatRunLogLine(entry);
      if (!line) {
        continue;
      }

      const sink = entry?.level === "warn" || entry?.level === "error" ? process.stderr : process.stdout;
      sink.write(`${line}\n`);
    }
  } finally {
    await client.close();
  }
}

export async function commandRun(options, fileArg = null) {
  return commandRunSource(options, await readScriptSource(fileArg));
}
