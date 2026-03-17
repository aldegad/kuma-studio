import http from "node:http";

import { AgentNoteStore, watchAgentNotes } from "./agent-note-store.mjs";
import { BrowserSessionStore } from "./browser-session-store.mjs";
import { BrowserExtensionStatusStore } from "./browser-extension-status-store.mjs";
import { DevSelectionStore } from "./dev-selection-store.mjs";
import { encodeAgentNoteEvent, encodeSceneEvent, ensureSceneShape } from "./scene-schema.mjs";
import { SceneStore, watchSceneFile } from "./scene-store.mjs";
import { resolveAgentNoteSessionId } from "./session-resolvers.mjs";

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
    this.publish(encodeSceneEvent(normalized, source));
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

function parseBrowserCommandClaim(searchParams) {
  return {
    tabId: searchParams.get("tabId") ? Number(searchParams.get("tabId")) : null,
    url: searchParams.get("url"),
    visible: searchParams.get("visible") === "true",
    focused: searchParams.get("focused") === "true",
  };
}

function isNodeNotFoundError(error) {
  return String(error?.message ?? "").startsWith("Node not found:");
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
  const browserSessionStore = new BrowserSessionStore();

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

    if (request.method === "GET" && url.pathname === "/browser-session") {
      sendJson(response, 200, browserSessionStore.readSummary());
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
        sendJson(response, 200, selectionStore.write(await readJsonBody(request)));
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
        extensionStatusStore.write(await readJsonBody(request));
        sendJson(response, 200, extensionStatusStore.readSummary());
        return;
      }

      if (request.method === "POST" && url.pathname === "/browser-session/heartbeat") {
        sendJson(response, 200, browserSessionStore.heartbeat(await readJsonBody(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/browser-session/commands") {
        sendJson(response, 200, browserSessionStore.enqueueCommand(await readJsonBody(request)));
        return;
      }

      if (request.method === "GET" && url.pathname === "/browser-session/commands/next") {
        const command = browserSessionStore.claimNextCommand(parseBrowserCommandClaim(url.searchParams));
        if (!command) {
          sendNoContent(response);
          return;
        }

        sendJson(response, 200, command);
        return;
      }

      const browserCommandMatch = url.pathname.match(/^\/browser-session\/commands\/([^/]+)$/);
      if (browserCommandMatch && request.method === "GET") {
        const command = browserSessionStore.readCommand(browserCommandMatch[1]);
        if (!command) {
          sendNoContent(response);
          return;
        }

        sendJson(response, 200, command);
        return;
      }

      const browserCommandResultMatch = url.pathname.match(/^\/browser-session\/commands\/([^/]+)\/result$/);
      if (browserCommandResultMatch && request.method === "POST") {
        sendJson(
          response,
          200,
          browserSessionStore.completeCommand(browserCommandResultMatch[1], await readJsonBody(request)),
        );
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
        sendJson(response, 200, store.write(await readJsonBody(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/scene/nodes") {
        sendJson(response, 200, store.addNode(await readJsonBody(request)));
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/scene/meta") {
        sendJson(response, 200, store.updateMeta(await readJsonBody(request)));
        return;
      }

      const nodeMatch = url.pathname.match(/^\/scene\/nodes\/(.+)$/);
      if (nodeMatch && request.method === "PATCH") {
        sendJson(response, 200, store.updateNode(nodeMatch[1], await readJsonBody(request)));
        return;
      }

      if (nodeMatch && request.method === "DELETE") {
        sendJson(response, 200, store.removeNode(nodeMatch[1]));
        return;
      }
    } catch (error) {
      if (isNodeNotFoundError(error)) {
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
