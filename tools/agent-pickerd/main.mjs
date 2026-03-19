import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { AgentNoteStore } from "./lib/agent-note-store.mjs";
import {
  commandBrowserClick,
  commandBrowserClickPoint,
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
import { resolveAgentNoteSessionId } from "./lib/session-resolvers.mjs";

function printUsage() {
  process.stdout.write(`agent-pickerd

Usage:
  node main.mjs serve [--host 127.0.0.1] [--port 4312] [--root .]
  node main.mjs get-scene [--root .]
  node main.mjs get-selection [--session-id session-01] [--root .]
  node main.mjs get-agent-note [--session-id session-01] [--root .]
  node main.mjs get-extension-status [--root .]
  node main.mjs get-browser-session [--daemon-url http://127.0.0.1:4312]
  node main.mjs set-agent-note --author codex --status fixed --message "Updated the picked element." [--session-id session-01] [--selection-id selector-path] [--root .]
  node main.mjs clear-agent-note [--session-id session-01] [--root .]
  node main.mjs browser-context (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-dom (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-console (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-debugger-capture [--refresh] [--bypass-cache] [--capture-ms 3000] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--daemon-url http://127.0.0.1:4312] [--timeout-ms 15000]
  node main.mjs browser-click [--selector "#submit"] [--selector-path "main > button:nth-of-type(1)"] [--text "Continue"] [--exact-text] [--role tab] [--within "설정 모드"] [--nth 1] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 400] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-sequence (--steps '[{"type":"click","text":"File","assert":{"type":"wait-for-selector","selector":"[role=\"menu\"]","timeoutMs":1200}},{"type":"click","text":"Export video"}]' | --steps-file ./tmp/sequence.json) (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-click-point --x 120 --y 240 (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 400] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-fill --value "https://example.com/privacy" [--selector "input[name=url]"] [--selector-path "form input:nth-of-type(1)"] [--label "Privacy Policy URL"] [--text "Privacy Policy URL"] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 100] [--daemon-url http://127.0.0.1:4312]
  node main.mjs browser-key --key Tab [--shift] [--selector "input"] [--selector-path "form input:nth-of-type(1)"] [--text "Privacy Policy URL"] (--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--post-action-delay-ms 100] [--daemon-url http://127.0.0.1:4312]
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

function resolveAgentNoteSessionIdFromOptions(root, options, allowGlobalFallback = false) {
  return resolveAgentNoteSessionId(root, readOptionalString(options, "session-id"), allowGlobalFallback);
}

function commandServe(options) {
  const host = typeof options.host === "string" ? options.host : "127.0.0.1";
  const port = readNumber(options, "port", 4312);
  const root = typeof options.root === "string" ? options.root : ".";
  const { server, store } = createServer({ host, port, root });

  server.listen(port, host, () => {
    process.stdout.write(`agent-pickerd listening on http://${host}:${port}\n`);
    process.stdout.write(`scene path: ${store.scenePath}\n`);
  });

  const shutdown = () => {
    process.stdout.write("\nstopping agent-pickerd\n");
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

function commandGetSelection(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const selectionStore = new DevSelectionStore(root);
  const sessionId = readOptionalString(options, "session-id");
  const selection = sessionId ? selectionStore.readSession(sessionId) : selectionStore.readAll();
  process.stdout.write(`${JSON.stringify(selection ?? null, null, 2)}\n`);
}

function commandGetAgentNote(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const sessionId = resolveAgentNoteSessionIdFromOptions(root, options, true);
  const agentNoteStore = new AgentNoteStore(root);
  process.stdout.write(`${JSON.stringify(sessionId ? agentNoteStore.readSession(sessionId) : null, null, 2)}\n`);
}

function commandGetExtensionStatus(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const extensionStatusStore = new BrowserExtensionStatusStore(root);
  process.stdout.write(`${JSON.stringify(extensionStatusStore.readSummary(), null, 2)}\n`);
}

function commandSetAgentNote(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const sessionId = resolveAgentNoteSessionIdFromOptions(root, options, true);
  const agentNoteStore = new AgentNoteStore(root);
  const note = agentNoteStore.write(
    {
      sessionId,
      selectionId: readOptionalString(options, "selection-id"),
      author: requireString(options, "author"),
      status: requireString(options, "status"),
      message: requireString(options, "message"),
    },
    { sessionId },
  );
  process.stdout.write(`${JSON.stringify(note, null, 2)}\n`);
}

function commandClearAgentNote(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const sessionId = resolveAgentNoteSessionIdFromOptions(root, options, true);
  const agentNoteStore = new AgentNoteStore(root);
  process.stdout.write(`${JSON.stringify(sessionId ? agentNoteStore.deleteSession(sessionId) : null, null, 2)}\n`);
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
    case "get-agent-note":
      commandGetAgentNote(options);
      return;
    case "get-extension-status":
      commandGetExtensionStatus(options);
      return;
    case "get-browser-session":
      await commandGetBrowserSession(options);
      return;
    case "set-agent-note":
      commandSetAgentNote(options);
      return;
    case "clear-agent-note":
      commandClearAgentNote(options);
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
