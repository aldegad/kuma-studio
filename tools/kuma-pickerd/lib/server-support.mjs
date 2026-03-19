import { encodeAgentNoteEvent, encodeSceneEvent, ensureSceneShape } from "./scene-schema.mjs";

export function createJsonHeaders(statusCode, payload) {
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

export function sendJson(response, statusCode, payload) {
  const { headers, body } = createJsonHeaders(statusCode, payload);
  response.writeHead(statusCode, headers);
  response.end(body);
}

export function sendNoContent(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end();
}

export function sendBinary(response, statusCode, body, contentType) {
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

export function readJsonBody(request) {
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

export class SceneEventBroker {
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

export function isNodeNotFoundError(error) {
  return String(error?.message ?? "").startsWith("Node not found:");
}

export function readSocketJson(raw) {
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
  return JSON.parse(text || "{}");
}

export function sendSocketJson(socket, payload) {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

export function buildBrowserSessionResponse(sessionSummary, extensionSummary) {
  const socketConnected = extensionSummary?.socketConnected === true;
  const lastSocketError = extensionSummary?.lastSocketError ?? null;
  const lastSocketErrorAt = extensionSummary?.lastSocketErrorAt ?? null;
  const merged = {
    ...sessionSummary,
    browserTransport: "websocket",
    socketConnected,
    lastSocketError,
    lastSocketErrorAt,
  };

  if (sessionSummary.connected) {
    return merged;
  }

  if (lastSocketError) {
    return {
      ...merged,
      message: `The Kuma Picker WebSocket bridge is not connected: ${lastSocketError}`,
    };
  }

  if (extensionSummary?.detected && socketConnected !== true) {
    return {
      ...merged,
      message: "The Kuma Picker extension was detected, but the WebSocket bridge is not connected.",
    };
  }

  if (extensionSummary?.detected) {
    return {
      ...merged,
      message:
        "The Kuma Picker bridge is connected, but no live page presence is cached yet. Direct tab-targeted commands can still be attempted.",
    };
  }

  return merged;
}
