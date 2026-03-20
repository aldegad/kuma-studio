import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  commandBrowserClick,
  commandBrowserClickPoint,
  commandBrowserPointerDrag,
  commandBrowserConsole,
  commandBrowserContext,
  commandBrowserDebuggerCapture,
  commandBrowserDom,
  commandBrowserFill,
  commandBrowserGetLatestDownload,
  commandBrowserKey,
  commandBrowserQueryDom,
  commandBrowserRefresh,
  commandBrowserSequence,
  commandBrowserScreenshot,
  commandBrowserWaitForDownload,
  commandBrowserWaitForDialogClose,
  commandBrowserWaitForSelector,
  commandBrowserWaitForText,
  commandBrowserWaitForTextDisappear,
  commandGetBrowserSession,
} from "./lib/browser-cli.mjs";
import { parseFlags, readNumber, readOptionalString, requireString } from "./lib/cli-options.mjs";
export { createServer } from "./lib/server.mjs";
import { createServer } from "./lib/server.mjs";
import { BrowserExtensionStatusStore } from "./lib/browser-extension-status-store.mjs";
import { DevSelectionStore } from "./lib/dev-selection-store.mjs";
import { normalizeViewport } from "./lib/scene-schema.mjs";
import { SceneStore } from "./lib/scene-store.mjs";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:4312";

function printUsage() {
  process.stdout.write(`kuma-pickerd

Usage:
  node main.mjs serve [--host 127.0.0.1] [--port 4312] [--root .]
  node main.mjs get-scene [--root .]
  node main.mjs get-selection [--session-id session-01] [--recent 5 | --all] [--root .]
  node main.mjs get-job-card [--session-id session-01] [--daemon-url http://127.0.0.1:4312]
  node main.mjs get-extension-status [--root .]
  node main.mjs get-browser-session [--daemon-url http://127.0.0.1:4312]
  node main.mjs set-job-status --status in_progress --message "작업 중인 내용을 짧게 적기" [--session-id session-01] [--author codex] [--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com"] [--selector "#submit"] [--selector-path "main > button:nth-of-type(1)"] [--rect-json '{"x":10,"y":20,"width":120,"height":48}'] [--daemon-url http://127.0.0.1:4312] [--root .]
  node main.mjs browser-context (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-dom (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-console (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-debugger-capture [--refresh] [--bypass-cache] [--capture-ms 3000] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-click [--selector "#submit"] [--selector-path "main > button:nth-of-type(1)"] [--text "Continue"] [--exact-text] [--role tab] [--within "설정 모드"] [--nth 1] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 400] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-sequence (--steps '[{"type":"click","text":"File","assert":{"type":"wait-for-selector","selector":"[role=\"menu\"]","timeoutMs":1200}},{"type":"click","text":"Export video"}]' | --steps-file ./tmp/sequence.json) (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-click-point --x 120 --y 240 (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 400] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-pointer-drag ([--from-x 120 --from-y 240 --to-x 360 --to-y 240] | [--waypoints '[{"x":120,"y":240},{"x":240,"y":260},{"x":360,"y":240}]']) [--steps 12] [--duration-ms 280] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 120] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-fill --value "https://example.com/privacy" [--selector "input[name=url]"] [--selector-path "form input:nth-of-type(1)"] [--label "Privacy Policy URL"] [--text "Privacy Policy URL"] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 100] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-key --key Tab [--shift] [--hold-ms 250] [--selector "input"] [--selector-path "form input:nth-of-type(1)"] [--text "Privacy Policy URL"] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 100] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-refresh [--bypass-cache] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-screenshot --file ./tmp/browser.png [--selector "#submit"] [--selector-path "main > button:nth-of-type(1)"] [--scope page|dialog] [--x 120 --y 240 --width 300 --height 180] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--focus-tab-first] [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-wait-for-download [--filename-contains ".csv"] [--download-url-contains "export"] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-get-latest-download [--filename-contains ".csv"] [--download-url-contains "export"] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-wait-for-text --text "Saved" (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--scope page|dialog] [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-wait-for-text-disappear --text "Saving..." (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--scope page|dialog] [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-wait-for-selector [--selector ".toast-success"] [--selector-path "body > div:nth-of-type(4)"] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--scope page|dialog] [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-wait-for-dialog-close (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-query-dom --kind required-fields|all-textareas|nearby-input|input-by-label|menu-state|selected-option|tab-state (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--scope page|dialog] [--text "Site URL"] [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs put-scene --file ./scene.json [--root .]
  node main.mjs add-node --id node-01 --item-id draft-01 --title "Draft 01" --viewport original --x 0 --y 0 --z-index 1 [--root .]
  node main.mjs move-node --id node-01 --x 120 --y 80 [--root .]
  node main.mjs remove-node --id node-01 [--root .]
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
    process.stdout.write(`kuma-pickerd listening on http://${host}:${port}\n`);
    process.stdout.write(`scene path: ${store.scenePath}\n`);
  });

  const shutdown = () => {
    process.stdout.write("\nstopping kuma-pickerd\n");
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

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const options = parseFlags(rest);

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
    case "set-job-status":
      await commandSetJobStatus(options);
      return;
    case "browser-context":
      await commandBrowserContext(options);
      return;
    case "browser-dom":
      await commandBrowserDom(options);
      return;
    case "browser-console":
      await commandBrowserConsole(options);
      return;
    case "browser-debugger-capture":
      await commandBrowserDebuggerCapture(options);
      return;
    case "browser-click":
      await commandBrowserClick(options);
      return;
    case "browser-sequence":
      await commandBrowserSequence(options);
      return;
    case "browser-click-point":
      await commandBrowserClickPoint(options);
      return;
    case "browser-pointer-drag":
      await commandBrowserPointerDrag(options);
      return;
    case "browser-fill":
      await commandBrowserFill(options);
      return;
    case "browser-key":
      await commandBrowserKey(options);
      return;
    case "browser-refresh":
      await commandBrowserRefresh(options);
      return;
    case "browser-screenshot":
      await commandBrowserScreenshot(options);
      return;
    case "browser-wait-for-download":
      await commandBrowserWaitForDownload(options);
      return;
    case "browser-get-latest-download":
      await commandBrowserGetLatestDownload(options);
      return;
    case "browser-wait-for-text":
      await commandBrowserWaitForText(options);
      return;
    case "browser-wait-for-text-disappear":
      await commandBrowserWaitForTextDisappear(options);
      return;
    case "browser-wait-for-selector":
      await commandBrowserWaitForSelector(options);
      return;
    case "browser-wait-for-dialog-close":
      await commandBrowserWaitForDialogClose(options);
      return;
    case "browser-query-dom":
      await commandBrowserQueryDom(options);
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
