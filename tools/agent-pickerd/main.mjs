import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentNoteStore, DEFAULT_AGENT_NOTE_SESSION_ID, watchAgentNotes } from "./lib/agent-note-store.mjs";
import { BrowserExtensionStatusStore } from "./lib/browser-extension-status-store.mjs";
import { DevSelectionStore } from "./lib/dev-selection-store.mjs";
import { encodeAgentNoteEvent, encodeSceneEvent, ensureSceneShape, normalizeViewport } from "./lib/scene-schema.mjs";
import { SceneStore, watchSceneFile } from "./lib/scene-store.mjs";

function printUsage() {
  process.stdout.write(`agent-pickerd

Usage:
  node main.mjs serve [--host 127.0.0.1] [--port 4312] [--root .]
  node main.mjs get-scene [--root .]
  node main.mjs get-selection [--session-id session-01] [--root .]
  node main.mjs get-agent-note [--session-id session-01] [--root .]
  node main.mjs get-extension-status [--root .]
  node main.mjs set-agent-note --author codex --status fixed --message "Updated the picked element." [--session-id session-01] [--selection-id selector-path] [--root .]
  node main.mjs clear-agent-note [--session-id session-01] [--root .]
  node main.mjs put-scene --file ./scene.json [--root .]
  node main.mjs add-node --id node-01 --item-id draft-01 --title "Draft 01" --viewport original --x 0 --y 0 --z-index 1 [--root .]
  node main.mjs move-node --id node-01 --x 120 --y 80 [--root .]
  node main.mjs remove-node --id node-01 [--root .]
`);
}

function parseFlags(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = nextToken;
    index += 1;
  }

  return options;
}

function requireString(options, key) {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option: --${key}`);
  }
  return value;
}

function readNumber(options, key, fallback = undefined) {
  const raw = options[key];
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number for --${key}`);
  }
  return value;
}

function readOptionalString(options, key) {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createJsonHeaders(statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(body.length),
    },
    body,
  };
}

function sendJson(response, statusCode, payload) {
  const { headers, body } = createJsonHeaders(statusCode, payload);
  response.writeHead(statusCode, headers);
  response.end(body);
}

function sendNoContent(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end();
}

function sendBinary(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Length": String(body.length),
    "Content-Type": contentType,
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "{}";
        resolveBody(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

class SceneEventBroker {
  constructor() {
    this.listeners = new Map();
    this.nextListenerId = 1;
    this.lastSignature = "";
    this.lastAgentNoteSignatures = new Map();
  }

  subscribe(response) {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    this.listeners.set(listenerId, response);
    return listenerId;
  }

  unsubscribe(listenerId) {
    this.listeners.delete(listenerId);
  }

  publish(message) {
    for (const [listenerId, response] of this.listeners.entries()) {
      try {
        response.write(message);
      } catch {
        this.listeners.delete(listenerId);
      }
    }
  }

  publishScene(scene, source) {
    const normalized = ensureSceneShape(scene);
    const signature = JSON.stringify(normalized);
    if (signature === this.lastSignature) return;

    this.lastSignature = signature;
    const message = encodeSceneEvent(normalized, source);
    this.publish(message);
  }

  publishAgentNote(note, source, deleted = false) {
    const sessionId = typeof note?.sessionId === "string" ? note.sessionId : null;
    if (!sessionId) {
      return;
    }

    const signature = deleted ? "__deleted__" : JSON.stringify(note);
    if (this.lastAgentNoteSignatures.get(sessionId) === signature) {
      return;
    }

    this.lastAgentNoteSignatures.set(sessionId, signature);
    this.publish(encodeAgentNoteEvent(note, source, deleted));
  }
}

export function createServer({ host, port, root }) {
  const broker = new SceneEventBroker();
  const store = new SceneStore(root, {
    onChange(scene, source) {
      broker.publishScene(scene, source);
    },
  });
  const selectionStore = new DevSelectionStore(root);
  const agentNoteStore = new AgentNoteStore(root);
  const extensionStatusStore = new BrowserExtensionStatusStore(root);

  store.ensure();
  broker.publishScene(store.read(), "startup");

  const stopWatching = watchSceneFile(store, (scene, source) => {
    broker.publishScene(scene, source);
  });
  const stopWatchingAgentNotes = watchAgentNotes(agentNoteStore, (note, source, deleted) => {
    broker.publishAgentNote(note, source, deleted);
  });

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/scene") {
      sendJson(response, 200, store.read());
      return;
    }

    if (request.method === "GET" && url.pathname === "/dev-selection") {
      const sessionId = url.searchParams.get("sessionId");
      const selection = sessionId ? selectionStore.readSession(sessionId) : selectionStore.readAll();
      if (!selection) {
        sendNoContent(response);
        return;
      }

      sendJson(response, 200, selection);
      return;
    }

    if (request.method === "GET" && url.pathname === "/agent-note") {
      const sessionId = resolveAgentNoteSessionId(root, url.searchParams.get("sessionId"), true);
      const note = sessionId ? agentNoteStore.readSession(sessionId) : null;
      if (!note) {
        sendNoContent(response);
        return;
      }

      sendJson(response, 200, note);
      return;
    }

    if (request.method === "GET" && url.pathname === "/extension-status") {
      sendJson(response, 200, extensionStatusStore.readSummary());
      return;
    }

    const assetMatch = url.pathname.match(/^\/dev-selection\/assets\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,128})$/);
    if (request.method === "GET" && assetMatch) {
      const asset = selectionStore.readAsset(assetMatch[1], assetMatch[2]);
      if (!asset) {
        sendNoContent(response);
        return;
      }

      sendBinary(response, 200, asset.body, asset.mimeType);
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
      });
      response.write("retry: 1000\n\n");
      response.write(encodeSceneEvent(store.read(), "initial"));

      const listenerId = broker.subscribe(response);
      const keepAlive = setInterval(() => {
        try {
          response.write(": keepalive\n\n");
        } catch {
          clearInterval(keepAlive);
          broker.unsubscribe(listenerId);
        }
      }, 20_000);

      const close = () => {
        clearInterval(keepAlive);
        broker.unsubscribe(listenerId);
      };

      request.on("close", close);
      response.on("close", close);
      return;
    }

    try {
      if (request.method === "DELETE" && url.pathname === "/dev-selection") {
        selectionStore.clearAll();
        sendNoContent(response);
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/dev-selection/session") {
        const sessionId = url.searchParams.get("sessionId");
        const selection = selectionStore.deleteSession(sessionId);
        const deletedNote = agentNoteStore.deleteSession(sessionId);
        if (!selection) {
          sendNoContent(response);
          return;
        }

        if (deletedNote) {
          broker.publishAgentNote(deletedNote, "selection-session-delete", true);
        }

        sendJson(response, 200, selection);
        return;
      }

      if (request.method === "POST" && url.pathname === "/dev-selection") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, selectionStore.write(payload));
        return;
      }

      if (request.method === "POST" && url.pathname === "/agent-note") {
        const payload = await readJsonBody(request);
        const fallbackSessionId = resolveAgentNoteSessionId(root, payload?.sessionId ?? null, true);
        const note = agentNoteStore.write(payload, { sessionId: fallbackSessionId });
        broker.publishAgentNote(note, "agent-note-write");
        sendJson(response, 200, note);
        return;
      }

      if (request.method === "POST" && url.pathname === "/extension-status") {
        const payload = await readJsonBody(request);
        extensionStatusStore.write(payload);
        sendJson(response, 200, extensionStatusStore.readSummary());
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/agent-note") {
        const sessionId = resolveAgentNoteSessionId(root, url.searchParams.get("sessionId"), true);
        const note = sessionId ? agentNoteStore.deleteSession(sessionId) : null;
        if (!note) {
          sendNoContent(response);
          return;
        }

        broker.publishAgentNote(note, "agent-note-delete", true);
        sendJson(response, 200, note);
        return;
      }

      if (request.method === "PUT" && url.pathname === "/scene") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, store.write(payload));
        return;
      }

      if (request.method === "POST" && url.pathname === "/scene/nodes") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, store.addNode(payload));
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/scene/meta") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, store.updateMeta(payload));
        return;
      }

      const nodeMatch = url.pathname.match(/^\/scene\/nodes\/(.+)$/);
      if (nodeMatch && request.method === "PATCH") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, store.updateNode(nodeMatch[1], payload));
        return;
      }

      if (nodeMatch && request.method === "DELETE") {
        sendJson(response, 200, store.removeNode(nodeMatch[1]));
        return;
      }
    } catch (error) {
      if (String(error?.message ?? "").startsWith("Node not found:")) {
        sendJson(response, 404, { error: error.message });
        return;
      }

      sendJson(response, 400, { error: error instanceof Error ? error.message : "Request failed" });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  server.on("close", () => {
    stopWatching();
    stopWatchingAgentNotes();
  });

  return { server, store };
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

function resolveSessionIdFromOptions(root, options) {
  const explicitSessionId = readOptionalString(options, "session-id");
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const selectionStore = new DevSelectionStore(root);
  return selectionStore.readAll()?.latestSessionId ?? null;
}

function resolveAgentNoteSessionId(root, sessionId, allowGlobalFallback = false) {
  const explicitSessionId =
    typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const selectionStore = new DevSelectionStore(root);
  return selectionStore.readAll()?.latestSessionId ?? (allowGlobalFallback ? DEFAULT_AGENT_NOTE_SESSION_ID : null);
}

function resolveAgentNoteSessionIdFromOptions(root, options, allowGlobalFallback = false) {
  return resolveAgentNoteSessionId(root, readOptionalString(options, "session-id"), allowGlobalFallback);
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
  const node = {
    id: requireString(options, "id"),
    itemId: requireString(options, "item-id"),
    title: requireString(options, "title"),
    viewport: normalizeViewport(requireString(options, "viewport")),
    x: readNumber(options, "x", 0),
    y: readNumber(options, "y", 0),
    zIndex: readNumber(options, "z-index", 1),
  };

  process.stdout.write(`${JSON.stringify(store.addNode(node), null, 2)}\n`);
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

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const options = parseFlags(rest);

  switch (command) {
    case "serve":
      commandServe(options);
      break;
    case "get-scene":
      commandGetScene(options);
      break;
    case "get-selection":
      commandGetSelection(options);
      break;
    case "get-agent-note":
      commandGetAgentNote(options);
      break;
    case "get-extension-status":
      commandGetExtensionStatus(options);
      break;
    case "set-agent-note":
      commandSetAgentNote(options);
      break;
    case "clear-agent-note":
      commandClearAgentNote(options);
      break;
    case "put-scene":
      commandPutScene(options);
      break;
    case "add-node":
      commandAddNode(options);
      break;
    case "move-node":
      commandMoveNode(options);
      break;
    case "remove-node":
      commandRemoveNode(options);
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  main();
}
