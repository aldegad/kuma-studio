import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { commandBrowserScreenshot, commandGetBrowserSession } from "./browser-cli.mjs";
import { commandRun } from "./playwright-runner.mjs";
import { parseFlags, readNumber, readOptionalString, requireString } from "./cli-options.mjs";
export { createServer } from "./server.mjs";
import { createServer } from "./server.mjs";
import { BrowserExtensionStatusStore } from "./browser-extension-status-store.mjs";
import { DevSelectionStore } from "./dev-selection-store.mjs";
import { normalizeViewport } from "./scene-schema.mjs";
import { SceneStore } from "./scene-store.mjs";
import { computeProjectHash, resolveKumaPickerStateDir, resolveProjectStateDir } from "./state-home.mjs";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:4312";

function printUsage() {
  process.stdout.write(`kuma-studio

Usage:
  kuma-studio serve [--host 127.0.0.1] [--port 4312] [--root .]
  kuma-studio get-scene [--root .]
  kuma-studio get-selection [--session-id session-01] [--recent 5 | --all] [--root .]
  kuma-studio get-job-card [--session-id session-01] [--daemon-url http://127.0.0.1:4312]
  kuma-studio get-extension-status [--root .]
  kuma-studio get-browser-session [--daemon-url http://127.0.0.1:4312]
  kuma-studio browser-screenshot [--file /tmp/kuma-studio-screenshot.png] [--tab-id 123] [--url-contains "example.com"] [--daemon-url http://127.0.0.1:4312]
  kuma-studio run [script.js] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  kuma-studio set-job-status --status in_progress --message "Write a short progress note" [--session-id session-01] [--author codex] [--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com"] [--selector "#submit"] [--selector-path "main > button:nth-of-type(1)"] [--rect-json '{"x":10,"y":20,"width":120,"height":48}'] [--daemon-url http://127.0.0.1:4312] [--root .]
  kuma-studio put-scene --file ./scene.json [--root .]
  kuma-studio add-node --id node-01 --item-id draft-01 --title "Draft 01" --viewport original --x 0 --y 0 --z-index 1 [--root .]
  kuma-studio move-node --id node-01 --x 120 --y 80 [--root .]
  kuma-studio remove-node --id node-01 [--root .]
  kuma-studio project-info [--root .]            # show current project hash and state dir
  kuma-studio list-projects                      # list all known project state directories
  kuma-studio dashboard                          # open http://localhost:4312/studio
`);
}

function resolveSelectionSessionId(root, options) {
  const explicitSessionId = readOptionalString(options, "session-id");
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const selectionStore = new DevSelectionStore(root);
  return selectionStore.readAll()?.latestSessionId ?? null;
}

function readDaemonUrlOption(options) {
  return readOptionalString(options, "daemon-url") ?? DEFAULT_DAEMON_URL;
}

function buildJobCardTargetFromOptions(options) {
  const tabId = readNumber(options, "tab-id", null);
  const url = readOptionalString(options, "url");
  const urlContains = readOptionalString(options, "url-contains");

  if (!Number.isInteger(tabId) && !url && !urlContains) {
    return null;
  }

  return {
    tabId: Number.isInteger(tabId) ? tabId : null,
    url: url ?? null,
    urlContains: urlContains ?? null,
  };
}

function buildJobCardAnchorFromOptions(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const rectJson = readOptionalString(options, "rect-json");
  let rect = null;

  if (rectJson) {
    try {
      rect = JSON.parse(rectJson);
    } catch {
      throw new Error("--rect-json must be valid JSON.");
    }
  }

  if (!selector && !selectorPath && !rect) {
    return null;
  }

  return {
    selector: selector ?? null,
    selectorPath: selectorPath ?? null,
    rect,
  };
}

async function readJobCardFromDaemon(daemonUrl, sessionId = null) {
  const search = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const response = await fetch(`${daemonUrl}/job-card${search}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error((await response.text()) || `Failed to read job cards from ${daemonUrl}.`);
  }

  return response.json();
}

async function writeJobCardToDaemon(daemonUrl, payload) {
  const response = await fetch(`${daemonUrl}/job-card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Failed to write the job card to ${daemonUrl}.`);
  }

  return response.json();
}

function commandServe(options) {
  const host = typeof options.host === "string" ? options.host : "127.0.0.1";
  const port = readNumber(options, "port", 4312);
  const root = typeof options.root === "string" ? options.root : ".";
  const { server, store } = createServer({ host, port, root });

  server.listen(port, host, () => {
    process.stdout.write(`kuma-studio listening on http://${host}:${port}\n`);
    process.stdout.write(`scene path: ${store.scenePath}\n`);
  });

  const shutdown = () => {
    process.stdout.write("\nstopping kuma-studio\n");
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function commandGetScene(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(`${JSON.stringify(store.read(), null, 2)}\n`);
}

function readPositiveIntegerOption(options, key) {
  const value = readNumber(options, key, null);
  if (value == null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${key} must be a positive integer.`);
  }

  return value;
}

function sliceRecentSelections(collection, count) {
  if (!collection || !Array.isArray(collection.sessions)) {
    return null;
  }

  const sessions = collection.sessions.slice(-count);
  const latestSessionId = sessions[sessions.length - 1]?.session?.id ?? null;

  return {
    ...collection,
    updatedAt: sessions[sessions.length - 1]?.capturedAt ?? collection.updatedAt,
    latestSessionId,
    sessions,
  };
}

function commandGetSelection(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const selectionStore = new DevSelectionStore(root);
  const sessionId = readOptionalString(options, "session-id");
  const recentCount = readPositiveIntegerOption(options, "recent");
  let selection = null;

  if (sessionId) {
    selection = selectionStore.readSession(sessionId);
  } else if (options.all === true) {
    selection = selectionStore.readAll();
  } else if (recentCount) {
    selection = sliceRecentSelections(selectionStore.readAll(), recentCount);
  } else {
    selection = selectionStore.read();
  }

  process.stdout.write(`${JSON.stringify(selection ?? null, null, 2)}\n`);
}

async function commandGetJobCard(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const sessionId = resolveSelectionSessionId(root, options);
  const daemonUrl = readDaemonUrlOption(options);
  process.stdout.write(`${JSON.stringify(await readJobCardFromDaemon(daemonUrl, sessionId), null, 2)}\n`);
}

function commandGetExtensionStatus(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const extensionStatusStore = new BrowserExtensionStatusStore(root);
  process.stdout.write(`${JSON.stringify(extensionStatusStore.readSummary(), null, 2)}\n`);
}

async function commandSetJobStatus(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const daemonUrl = readDaemonUrlOption(options);
  const sessionId = resolveSelectionSessionId(root, options);
  const resultMessage = requireString(options, "message");
  const payload = {
    sessionId,
    status: requireString(options, "status"),
    message: resultMessage,
    resultMessage,
    author: readOptionalString(options, "author") ?? "codex",
    target: buildJobCardTargetFromOptions(options),
    anchor: buildJobCardAnchorFromOptions(options),
  };

  process.stdout.write(`${JSON.stringify(await writeJobCardToDaemon(daemonUrl, payload), null, 2)}\n`);
}

function commandPutScene(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const file = resolve(requireString(options, "file"));
  const store = new SceneStore(root);
  const payload = JSON.parse(readFileSync(file, "utf8"));
  process.stdout.write(`${JSON.stringify(store.write(payload), null, 2)}\n`);
}

function commandAddNode(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(
    `${JSON.stringify(
      store.addNode({
        id: requireString(options, "id"),
        itemId: requireString(options, "item-id"),
        title: requireString(options, "title"),
        viewport: normalizeViewport(requireString(options, "viewport")),
        x: readNumber(options, "x", 0),
        y: readNumber(options, "y", 0),
        zIndex: readNumber(options, "z-index", 1),
      }),
      null,
      2,
    )}\n`,
  );
}

function commandMoveNode(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(
    `${JSON.stringify(
      store.updateNode(requireString(options, "id"), {
        x: readNumber(options, "x", 0),
        y: readNumber(options, "y", 0),
      }),
      null,
      2,
    )}\n`,
  );
}

function commandRemoveNode(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(`${JSON.stringify(store.removeNode(requireString(options, "id")), null, 2)}\n`);
}

function commandProjectInfo(options) {
  const root = typeof options.root === "string" ? resolve(options.root) : resolve(".");
  const hash = computeProjectHash(root);
  const stateDir = resolveProjectStateDir(root);
  const scenePath = resolve(stateDir, "scene.json");
  const hasScene = existsSync(scenePath);

  process.stdout.write(
    JSON.stringify(
      {
        projectRoot: root,
        projectHash: hash,
        stateDir,
        hasScene,
      },
      null,
      2,
    ) + "\n",
  );
}

function commandListProjects() {
  const stateHome = resolveKumaPickerStateDir();
  const projectsDir = resolve(stateHome, "projects");
  const results = [];

  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(projectsDir, entry.name);
      const metaPath = resolve(dir, "project.json");
      const scenePath = resolve(dir, "scene.json");
      let meta = null;
      try {
        meta = JSON.parse(readFileSync(metaPath, "utf8"));
      } catch {
        // No project metadata yet.
      }
      results.push({
        hash: entry.name,
        stateDir: dir,
        hasScene: existsSync(scenePath),
        projectRoot: meta?.projectRoot ?? null,
      });
    }
  }

  // Also include the legacy global state if scene.json exists at root level
  const globalScenePath = resolve(stateHome, "scene.json");
  if (existsSync(globalScenePath)) {
    results.unshift({
      hash: "(global)",
      stateDir: stateHome,
      hasScene: true,
      projectRoot: null,
    });
  }

  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const options = parseFlags(rest);
  const fileArg = typeof options._?.[0] === "string" ? options._[0] : null;

  switch (command) {
    case "serve":
      commandServe(options);
      return;
    case "get-scene":
      commandGetScene(options);
      return;
    case "get-selection":
      commandGetSelection(options);
      return;
    case "get-job-card":
      await commandGetJobCard(options);
      return;
    case "get-extension-status":
      commandGetExtensionStatus(options);
      return;
    case "get-browser-session":
      await commandGetBrowserSession(options);
      return;
    case "browser-screenshot":
      await commandBrowserScreenshot(options);
      return;
    case "run":
      await commandRun(options, fileArg);
      return;
    case "set-job-status":
      await commandSetJobStatus(options);
      return;
    case "put-scene":
      commandPutScene(options);
      return;
    case "add-node":
      commandAddNode(options);
      return;
    case "move-node":
      commandMoveNode(options);
      return;
    case "remove-node":
      commandRemoveNode(options);
      return;
    case "project-info":
      commandProjectInfo(options);
      return;
    case "list-projects":
      commandListProjects();
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
