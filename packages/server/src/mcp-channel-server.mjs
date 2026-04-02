#!/usr/bin/env node
/**
 * Kuma Picker MCP channel-push server.
 *
 * Runs as a stdio MCP server. On startup it connects to the kuma-studio
 * daemon's SSE /events stream and relays job-card events as
 * notifications/claude/channel pushes so Claude Code gets real-time alerts.
 *
 * Also exposes a handful of tools that wrap existing daemon HTTP endpoints
 * (get-selection, get-job-status, get-browser-session).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_PORT } from "./constants.mjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DAEMON_URL = process.env.KUMA_DAEMON_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write(`kuma-picker-mcp: ${msg}\n`);
}

async function daemonGet(path) {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Daemon ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function daemonPost(path, body) {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Daemon ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// SSE subscriber
// ---------------------------------------------------------------------------

function subscribeSSE(onJobCard, onError) {
  let abortController = new AbortController();

  async function connect() {
    try {
      const res = await fetch(`${DAEMON_URL}/events`, {
        signal: abortController.signal,
        headers: { Accept: "text/event-stream" },
      });

      if (!res.ok) {
        throw new Error(`SSE connect failed: ${res.status}`);
      }

      log("SSE connected to daemon");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent === "job-card") {
            try {
              const data = JSON.parse(line.slice(6));
              onJobCard(data);
            } catch {
              // malformed data line — skip
            }
            currentEvent = "";
          } else if (line === "") {
            currentEvent = "";
          }
        }
      }

      // Stream ended normally (daemon shut down?)
      throw new Error("SSE stream ended");
    } catch (err) {
      if (abortController.signal.aborted) return; // intentional teardown
      onError(err);
    }
  }

  connect();

  return {
    close() {
      abortController.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const mcp = new Server(
  { name: "kuma-picker", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      experimental: {
        "claude/channel": {},
      },
    },
    instructions: [
      "Kuma Picker channel — receives real-time job card alerts from the kuma-studio daemon.",
      "Use the tools to read the current browser selection, job card state, or browser session status.",
    ].join("\n"),
  },
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "get-selection",
    description:
      "Read the latest browser selection captured by Kuma Picker. Returns element info, screenshot path, page URL, and session metadata.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Optional session ID to read a specific selection.",
        },
      },
    },
  },
  {
    name: "get-job-status",
    description:
      "Read the current job card(s). Without sessionId returns all cards; with sessionId returns a single card.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Optional session ID to read a specific job card.",
        },
      },
    },
  },
  {
    name: "set-job-status",
    description:
      "Update a job card status and message. Use to report progress or completion back to the dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["noted", "in_progress", "completed"],
          description: "Job status.",
        },
        message: {
          type: "string",
          description: "Short progress or result note.",
        },
        sessionId: {
          type: "string",
          description: "Session ID of the job card to update.",
        },
        author: {
          type: "string",
          description: 'Author identifier (default: "claude").',
        },
      },
      required: ["status", "message"],
    },
  },
  {
    name: "get-browser-session",
    description:
      "Check the browser bridge connection status — whether the Kuma Picker extension is connected and active.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get-selection": {
        const path = args?.sessionId
          ? `/dev-selection?sessionId=${encodeURIComponent(args.sessionId)}`
          : "/dev-selection";
        const data = await daemonGet(path);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get-job-status": {
        const path = args?.sessionId
          ? `/job-card?sessionId=${encodeURIComponent(args.sessionId)}`
          : "/job-card";
        const data = await daemonGet(path);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "set-job-status": {
        const payload = {
          status: args.status,
          message: args.message,
          resultMessage: args.message,
          author: args.author ?? "claude",
          sessionId: args.sessionId ?? null,
        };
        const data = await daemonPost("/job-card", payload);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get-browser-session": {
        const data = await daemonGet("/browser-session");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function checkDaemonHealth() {
  try {
    const data = await daemonGet("/health");
    return data?.ok === true;
  } catch {
    return false;
  }
}

function formatJobCardContent(data) {
  if (data.deleted) {
    return `[kuma-picker] Job card deleted: ${data.id}`;
  }

  const card = data.card;
  if (!card) return null;

  const status = card.status ?? "unknown";
  const message = card.message ?? card.resultMessage ?? card.requestMessage ?? "";
  const author = card.author ?? "";
  const sessionId = card.sessionId ?? "";
  const url = card.target?.url ?? card.target?.urlContains ?? "";

  const parts = [`[kuma-picker] Job card ${status}`];
  if (author) parts.push(`by ${author}`);
  if (message) parts.push(`-- ${message}`);
  if (url) parts.push(`(${url})`);
  if (sessionId) parts.push(`[session: ${sessionId}]`);

  return parts.join(" ");
}

async function main() {
  // Check daemon is reachable before starting
  const healthy = await checkDaemonHealth();
  if (!healthy) {
    log(
      `ERROR: kuma-studio daemon is not reachable at ${DAEMON_URL}\n` +
        `  Start the daemon first:  node packages/server/src/cli.mjs serve\n` +
        `  Or set KUMA_DAEMON_URL to the correct address.`,
    );
    process.exit(1);
  }

  log("Daemon is healthy. Starting MCP server...");

  // Connect MCP transport
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log("MCP server connected via stdio");

  // Subscribe to daemon SSE for job-card events
  let reconnectAttempts = 0;

  function startSSE() {
    subscribeSSE(
      // onJobCard
      (data) => {
        reconnectAttempts = 0; // reset on successful data
        const content = formatJobCardContent(data);
        if (!content) return;

        mcp.notification({
          method: "notifications/claude/channel",
          params: {
            content,
            meta: {
              source: "kuma-picker",
              event: "job-card",
              jobId: data.id ?? null,
              deleted: data.deleted ?? false,
              status: data.card?.status ?? null,
              author: data.card?.author ?? null,
              sessionId: data.card?.sessionId ?? null,
            },
          },
        });
      },
      // onError
      (err) => {
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          log(`SSE reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Giving up.`);
          return;
        }
        log(`SSE disconnected (${err?.message ?? err}), reconnecting in ${RECONNECT_DELAY_MS}ms... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        setTimeout(startSSE, RECONNECT_DELAY_MS);
      },
    );
  }

  startSSE();

  // Graceful shutdown
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

main().catch((err) => {
  log(`Fatal: ${err?.message ?? err}`);
  process.exit(1);
});
