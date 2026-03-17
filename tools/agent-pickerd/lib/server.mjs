import http from "node:http";
import { WebSocketServer } from "ws";

import { AgentNoteStore, watchAgentNotes } from "./agent-note-store.mjs";
import { getBrowserTransportModeFromEnv } from "./browser-transport.mjs";
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

function readSocketJson(raw) {
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
  return JSON.parse(text || "{}");
}

function sendSocketJson(socket, payload) {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function buildBrowserSessionResponse(sessionSummary, extensionSummary, browserTransportMode) {
  const socketConnected = extensionSummary?.socketConnected === true;
  const lastSocketError = extensionSummary?.lastSocketError ?? null;
  const lastSocketErrorAt = extensionSummary?.lastSocketErrorAt ?? null;
  const merged = {
    ...sessionSummary,
    browserTransport: browserTransportMode,
    socketConnected,
    lastSocketError,
    lastSocketErrorAt,
  };

  if (sessionSummary.connected) {
    return merged;
  }

  if (browserTransportMode === "websocket" && lastSocketError) {
    return {
      ...merged,
      message: `The Agent Picker WebSocket bridge is not connected: ${lastSocketError}`,
    };
  }

  if (browserTransportMode === "websocket" && extensionSummary?.detected && socketConnected !== true) {
    return {
      ...merged,
      message: "The Agent Picker extension was detected, but the WebSocket bridge is not connected.",
    };
  }

  if (browserTransportMode === "websocket" && extensionSummary?.detected) {
    return {
      ...merged,
      message:
        "The Agent Picker bridge is connected, but no live page presence is cached yet. Direct tab-targeted commands can still be attempted.",
    };
  }

  return merged;
}

export function createServer({ host, port, root }) {
  const broker = new SceneEventBroker();
  const browserTransportMode = getBrowserTransportModeFromEnv();
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
  const socketServer = new WebSocketServer({ noServer: true });
  const socketStates = new Map();
  let nextSocketId = 1;
  const pingInterval = setInterval(() => {
    for (const state of socketStates.values()) {
      if (state.awaitingPong) {
        try {
          state.socket.close();
        } catch {
          // Ignore close races while cleaning up stale sockets.
        }
        continue;
      }

      state.awaitingPong = true;
      sendSocketJson(state.socket, { type: "ping", sentAt: new Date().toISOString() });
    }
  }, 10_000);

  function disconnectSocket(connectionId) {
    socketStates.delete(connectionId);
    browserSessionStore.disconnect(connectionId);
  }

  socketServer.on("connection", (socket) => {
    const connectionId = `socket-${nextSocketId++}`;
    socketStates.set(connectionId, {
      socket,
      awaitingPong: false,
      role: null,
    });

    socket.on("message", (rawMessage) => {
      let message = null;
      try {
        message = readSocketJson(rawMessage);
        switch (message?.type) {
          case "hello": {
            const record = browserSessionStore.registerHello(connectionId, message, (payload) => {
              sendSocketJson(socket, payload);
            });
            const state = socketStates.get(connectionId);
            if (state) {
              state.role = record.role;
            }
            if (record.role === "browser" && record.extensionId) {
              try {
                extensionStatusStore.write({
                  extensionId: record.extensionId,
                  extensionName: record.extensionName,
                  extensionVersion: record.extensionVersion,
                  browserName: record.browserName,
                  browserTransport: "websocket",
                  socketConnected: true,
                  lastSocketError: null,
                  lastSocketErrorAt: null,
                  source: "websocket:hello",
                  lastSeenAt: record.lastSeenAt,
                });
              } catch {
                // Ignore invalid metadata payloads so the socket can still finish the hello handshake.
              }
            }
            sendSocketJson(socket, {
              type: "hello",
              ok: true,
              role: record.role,
              browserTransport: browserTransportMode,
            });
            return;
          }
          case "presence.update": {
            const update = browserSessionStore.recordBrowserPresence(connectionId, message);
            extensionStatusStore.write(update.extensionStatus);
            return;
          }
          case "command.request":
            browserSessionStore.dispatchControllerCommand(connectionId, message);
            return;
          case "command.result":
            browserSessionStore.completeBrowserCommand(connectionId, message);
            return;
          case "command.error":
            browserSessionStore.failBrowserCommand(connectionId, message);
            return;
          case "ping":
            sendSocketJson(socket, { type: "pong", sentAt: new Date().toISOString() });
            return;
          case "pong": {
            const state = socketStates.get(connectionId);
            if (state) {
              state.awaitingPong = false;
            }
            return;
          }
          default:
            throw new Error(`Unknown browser socket message type: ${String(message?.type)}`);
        }
      } catch (error) {
        if (message?.type === "command.request" && typeof message?.requestId === "string") {
          sendSocketJson(socket, {
            type: "command.error",
            requestId: message.requestId,
            error: error instanceof Error ? error.message : "Browser command request failed.",
          });
          return;
        }

        sendSocketJson(socket, {
          type: "command.error",
          error: error instanceof Error ? error.message : "Browser socket request failed.",
        });
      }
    });

    socket.on("close", () => {
      const state = socketStates.get(connectionId);
      const summary = extensionStatusStore.readSummary();
      if (state?.role === "browser" && summary.detected) {
        extensionStatusStore.write({
          extensionId: summary.extensionId,
          browserTransport: browserTransportMode,
          socketConnected: false,
          source: "websocket:close",
          lastSeenAt: new Date().toISOString(),
        });
      }
      disconnectSocket(connectionId);
    });

    socket.on("error", () => {
      const state = socketStates.get(connectionId);
      const summary = extensionStatusStore.readSummary();
      if (state?.role === "browser" && summary.detected) {
        extensionStatusStore.write({
          extensionId: summary.extensionId,
          browserTransport: browserTransportMode,
          socketConnected: false,
          source: "websocket:error",
          lastSeenAt: new Date().toISOString(),
        });
      }
      disconnectSocket(connectionId);
    });
  });

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, browserTransport: browserTransportMode });
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
      sendJson(
        response,
        200,
        buildBrowserSessionResponse(
          browserSessionStore.readSummary(),
          extensionStatusStore.readSummary(),
          browserTransportMode,
        ),
      );
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
        if (browserTransportMode !== "legacy-poll") {
          sendJson(response, 410, { error: "Legacy browser polling transport is disabled." });
          return;
        }
        sendJson(response, 200, browserSessionStore.heartbeat(await readJsonBody(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/browser-session/commands") {
        if (browserTransportMode !== "legacy-poll") {
          sendJson(response, 410, { error: "Legacy browser polling transport is disabled." });
          return;
        }
        sendJson(response, 200, browserSessionStore.enqueueCommand(await readJsonBody(request)));
        return;
      }

      if (request.method === "GET" && url.pathname === "/browser-session/commands/next") {
        if (browserTransportMode !== "legacy-poll") {
          sendJson(response, 410, { error: "Legacy browser polling transport is disabled." });
          return;
        }
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
        if (browserTransportMode !== "legacy-poll") {
          sendJson(response, 410, { error: "Legacy browser polling transport is disabled." });
          return;
        }
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
        if (browserTransportMode !== "legacy-poll") {
          sendJson(response, 410, { error: "Legacy browser polling transport is disabled." });
          return;
        }
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

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (url.pathname !== "/browser-session/socket" || browserTransportMode !== "websocket") {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (websocket) => {
      socketServer.emit("connection", websocket, request);
    });
  });

  server.on("close", () => {
    stopWatching();
    stopWatchingAgentNotes();
    clearInterval(pingInterval);
    socketServer.close();
  });

  return { server, store };
}
