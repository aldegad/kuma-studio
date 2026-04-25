import fs from "node:fs";
import http from "node:http";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { BrowserSessionStore } from "./browser-session-store.mjs";
import { BrowserExtensionStatusStore } from "./browser-extension-status-store.mjs";
import { DevSelectionStore } from "./dev-selection-store.mjs";
import { buildJobCardFromSelection, JobCardStore } from "./job-card-store.mjs";
import { SceneStore, watchSceneFile } from "./scene-store.mjs";
import { ensureOfficeLayoutShape, encodeSceneEvent } from "./scene-schema.mjs";
import {
  SceneEventBroker,
  buildBrowserSessionResponse,
  isNodeNotFoundError,
  readJsonBody,
  readSocketJson,
  sendBinary,
  sendJson,
  sendNoContent,
  sendSocketJson,
} from "./server-support.mjs";
import { StudioWsEvents } from "./studio/studio-ws-events.mjs";
import { StatsStore } from "./studio/stats-store.mjs";
import { AgentStateManager, mapJobStatusToAgentState } from "./studio/agent-state.mjs";
import { getGitActivity, startGitActivityPolling, stopGitActivityPolling } from "./studio/git-activity-store.mjs";
import { TokenTracker } from "./studio/token-tracker.mjs";
import { TeamStatusStore, toStudioTeamStatusSnapshot } from "./studio/team-status-store.mjs";
import { createStudioRouteHandler } from "./studio/studio-routes.mjs";
import { ContentStore } from "./studio/content-store.mjs";
import { ExperimentStore } from "./studio/experiment-store.mjs";
import { TrendStore } from "./studio/trend-store.mjs";
import { createExperimentPipeline } from "./studio/experiment-pipeline.mjs";
import { MemoStore } from "./studio/memo-store.mjs";
import { TeamConfigStore, watchTeamConfig } from "./studio/team-config-store.mjs";
import { createTeamConfigRuntime } from "./studio/team-config-runtime.mjs";
import { createTeamConfigWatcherHandler } from "./studio/team-config-watcher.mjs";
import { isNightModeEnabled } from "./studio/nightmode-store.mjs";
import { AgentHistoryStore } from "./studio/agent-history-store.mjs";
import { DispatchBroker } from "./studio/dispatch-broker.mjs";
import { StudioUiStateStore } from "./studio/studio-ui-state-store.mjs";
import { runVaultLifecycleHook } from "./studio/vault-lifecycle-hook.mjs";
import { readPlans, watchPlans } from "./studio/plan-store.mjs";
import { createClaudeUsagePoller } from "./studio/claude-usage-poll.mjs";
import { watchStudioExplorerRoots } from "./studio/studio-explorer-routes.mjs";
import { loadTeamMetadata, getAgentHierarchy } from "./team-metadata.mjs";
import {
  DEFAULT_TEAM_WATCHER_LOG_PATH,
} from "./kuma-paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUDIO_DEV_HMR_CLIENT_PATH = "/__vite_ws";
const STUDIO_DEV_HMR_UPGRADE_PATH = "/studio/__vite_ws";

function appendTeamWatcherLog(message) {
  fs.mkdirSync(dirname(DEFAULT_TEAM_WATCHER_LOG_PATH), { recursive: true });
  fs.appendFileSync(DEFAULT_TEAM_WATCHER_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
}

export function resolveStudioWorkspaceRoot(root, envValue = process.env.KUMA_STUDIO_WORKSPACE) {
  const configured = typeof envValue === "string" ? envValue.trim() : "";
  return resolve(configured || root);
}

function createConnectMiddlewareDelegate(middlewares) {
  return async (req, res) => await new Promise((resolve, reject) => {
    const originalUrl = req.url ?? "/";
    let settled = false;

    const cleanup = () => {
      req.url = originalUrl;
      res.off?.("finish", onFinish);
      res.off?.("close", onClose);
    };

    const finish = (handled) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(handled);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const onFinish = () => finish(true);
    const onClose = () => {
      if (res.writableEnded || res.destroyed) {
        finish(true);
      }
    };

    res.once("finish", onFinish);
    res.once("close", onClose);

    middlewares(req, res, (error) => {
      if (error) {
        fail(error);
        return;
      }

      finish(Boolean(res.writableEnded || res.headersSent));
    });
  });
}

export async function createServer({ host, port, root }) {
  const broker = new SceneEventBroker();
  const studioWsEvents = new StudioWsEvents();
  const studioSocketClients = new Set();
  let lastOfficeLayoutSignature = "";
  const store = new SceneStore(root, {
    onChange(scene, source) {
      broker.publishScene(scene, source);
      broadcastOfficeLayout(scene.meta?.officeLayout, source);
    },
  });
  const selectionStore = new DevSelectionStore(root);
  const jobCardStore = new JobCardStore(root);
  const extensionStatusStore = new BrowserExtensionStatusStore(root);
  const browserSessionStore = new BrowserSessionStore();

  // --- Studio extensions ---
  const statsStore = new StatsStore(resolve(root, ".kuma-studio", "stats.db"));
  const agentStateManager = new AgentStateManager();
  const tokenTracker = new TokenTracker();
  const teamStatusStore = new TeamStatusStore();
  const agentHistoryStore = new AgentHistoryStore();
  const studioUiStateStore = new StudioUiStateStore();
  const contentStore = new ContentStore(root);
  const trendStore = new TrendStore(root);
  const experimentStore = new ExperimentStore(root);
  const experimentPipeline = createExperimentPipeline(resolve(root));
  const memoStore = new MemoStore(resolve(root));
  const teamConfigStore = new TeamConfigStore();
  teamConfigStore.ensure();
  const workspaceRoot = resolveStudioWorkspaceRoot(root);
  const teamConfigRuntime = createTeamConfigRuntime({
    teamStatusStore,
    teamConfigStore,
    logPath: DEFAULT_TEAM_WATCHER_LOG_PATH,
  });
  const dispatchBroker = new DispatchBroker({
    storagePath: resolve(root, ".kuma-studio", "dispatch-broker.json"),
    async runLifecycleHook({ event, taskFile, summary, blocker, note }) {
      const { warnings } = await runVaultLifecycleHook({ event, taskFile, summary, blocker, note });
      for (const warning of warnings) {
        process.stderr.write(`[vault-hook] ${warning.message}\n`);
      }
    },
  });
  const handleTeamConfigChange = createTeamConfigWatcherHandler({
    teamConfigRuntime,
    studioWsEvents,
    workspaceRoot,
    appendLog: appendTeamWatcherLog,
  });

  // Register agent hierarchy from team.json — session → team → worker
  const AGENT_HIERARCHY = getAgentHierarchy();
  for (const agent of AGENT_HIERARCHY) {
    agentStateManager.registerAgent(agent.id, agent);
  }

  // Wire up agent state changes to studio WS broadcast
  agentStateManager.onStateChange((agentId, snapshot) => {
    studioWsEvents.broadcastAgentStateChange(agentId, snapshot);
  });

  // Wire up token tracker to studio WS broadcast
  tokenTracker.onRecord((entry) => {
    studioWsEvents.broadcastTokenUsage(entry.agentId, entry.tokens, entry.model);
  });
  dispatchBroker.onChange((dispatch) => {
    studioWsEvents.broadcastDispatchUpdate(dispatch);
  });

  teamStatusStore.onChange((snapshot) => {
    studioWsEvents.broadcastTeamStatusUpdate(toStudioTeamStatusSnapshot(teamStatusStore.getSurfaceStates()));
    agentHistoryStore.recordFromSnapshot(snapshot, teamStatusStore.getMembersByName());
  });
  teamStatusStore.start();

  const studioStaticDir = resolve(__dirname, "../../studio-web/dist");
  const studioAppRoot = resolve(__dirname, "../../studio-web");
  const isProduction = process.env.NODE_ENV === "production";
  let studioViteServer = null;
  let studioDevDelegate = null;
  let handleStudioRoute = async () => false;
  startGitActivityPolling((activity) => {
    broadcastStudioEvent("git-activity-update", { activity });
  });

  store.ensure();
  const initialScene = store.read();
  broker.publishScene(initialScene, "startup");
  broadcastOfficeLayout(initialScene.meta?.officeLayout, "startup");

  const stopWatching = watchSceneFile(store, (scene, source) => {
    broker.publishScene(scene, source);
    broadcastOfficeLayout(scene.meta?.officeLayout, source);
  });

  // Watch browser-extension directory for dev auto-reload
  const extensionDir = resolve(__dirname, "../../browser-extension");
  let extensionReloadDebounce = null;
  let extensionWatcher = null;
  try {
    extensionWatcher = fs.watch(extensionDir, { recursive: true }, () => {
      clearTimeout(extensionReloadDebounce);
      extensionReloadDebounce = setTimeout(() => broadcastExtensionReload(), 500);
    });
    extensionWatcher.on("error", (error) => {
      const details = error instanceof Error ? error.message : "unknown error";
      console.error("extensionWatcher failed:", details);
      try {
        extensionWatcher?.close?.();
      } catch {
        // ignore close failures while recovering from watcher errors
      }
      extensionWatcher = null;
    });
  } catch {
    // Extension directory may not exist in production deployments.
  }

  const stopWatchingPlans = watchPlans({
    debounceMs: 500,
    onChange(snapshot) {
      studioWsEvents.broadcastPlansUpdate(snapshot);
    },
  });
  void readPlans();

  const claudeUsagePoller = createClaudeUsagePoller({
    onUpdate(snapshot) {
      studioWsEvents.broadcastClaudeUsage(snapshot);
    },
  });
  claudeUsagePoller.start();
  const stopWatchingExplorer = watchStudioExplorerRoots({
    workspaceRoot,
    studioWsEvents,
    onError(error) {
      const details = error instanceof Error ? error.message : "unknown error";
      console.error("watchStudioExplorerRoots failed:", details);
    },
  });

  const teamConfigWatcher = watchTeamConfig({
    debounceMs: 500,
    onChange: handleTeamConfigChange,
    onError(error) {
      const details = error instanceof Error ? error.message : "unknown error";
      console.error("watchTeamConfig failed:", details);
      appendTeamWatcherLog(`TEAM_CONFIG_WATCH_ERROR: ${details}`);
    },
  });
  console.log("watchTeamConfig registered");

  const socketServer = new WebSocketServer({ noServer: true });
  const socketStates = new Map();
  let nextSocketId = 1;
  const inFlightCommandCleanupInterval = setInterval(() => {
    browserSessionStore.pruneExpiredInFlightCommands();
  }, 30_000);

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

  function broadcastOfficeLayout(layout, source) {
    if (layout == null) {
      return;
    }

    const normalized = ensureOfficeLayoutShape(layout);
    const signature = JSON.stringify(normalized);
    if (signature === lastOfficeLayoutSignature && source !== "studio-layout-drag") {
      return;
    }

    lastOfficeLayoutSignature = signature;
    studioWsEvents.broadcastOfficeLayoutUpdate(normalized);
  }

  function publishJobCard(card, source, deleted = false) {
    broker.publishJobCard(card, source, deleted);

    for (const state of socketStates.values()) {
      if (state.role !== "browser") {
        continue;
      }

      sendSocketJson(state.socket, {
        type: "job-card.updated",
        source,
        deleted,
        card: deleted ? null : card,
        id: card?.id ?? null,
      });
    }

    // --- Studio: broadcast job card update and update agent state ---
    if (!deleted && card) {
      studioWsEvents.broadcastJobCardUpdate(card);

      // Record job event in stats store
      statsStore.recordJobEvent({
        jobId: card.id ?? "unknown",
        sessionId: card.sessionId ?? null,
        agentId: card.author ?? "unknown",
        status: card.status ?? "queued",
        message: card.message ?? card.resultMessage ?? "",
        tokensUsed: card.tokensUsed ?? 0,
        model: card.model ?? null,
      });

      // Update agent state based on job status
      if (card.author) {
        const agentState = mapJobStatusToAgentState(card.status);
        agentStateManager.setState(card.author, agentState, card.message ?? card.resultMessage ?? null);
      }

      // Track token usage if present
      if (card.tokensUsed > 0 && card.author) {
        tokenTracker.record(card.author, card.model ?? "unknown", card.tokensUsed);
      }
    }
  }

  function broadcastExtensionReload() {
    for (const state of socketStates.values()) {
      if (state.role !== "browser") {
        continue;
      }
      sendSocketJson(state.socket, { type: "extension.reload" });
    }
  }

  function broadcastStudioEvent(kind, payload = {}) {
    const message = {
      type: "kuma-studio:event",
      event: { kind, ...payload },
    };

    for (const client of studioSocketClients) {
      if (client.readyState !== 1 /* OPEN */) {
        continue;
      }

      try {
        sendSocketJson(client, message);
      } catch {
        studioSocketClients.delete(client);
      }
    }
  }

  function writeJobCardFromSelection(selection, source = "selection-write") {
    const card = buildJobCardFromSelection(selection);
    if (!card) {
      return null;
    }

    const persisted = jobCardStore.write(card, {
      id: card.id,
      sessionId: card.sessionId,
      selectionId: card.selectionId,
    });
    publishJobCard(persisted, source, false);
    return persisted;
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
              browserTransport: "websocket",
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
      disconnectSocket(connectionId);
      const hasActiveBrowserSocket = Array.from(socketStates.values()).some((s) => s.role === "browser");
      const summary = extensionStatusStore.readSummary();
      if (state?.role === "browser" && summary.detected && !hasActiveBrowserSocket) {
        extensionStatusStore.write({
          extensionId: summary.extensionId,
          browserTransport: "websocket",
          socketConnected: false,
          source: "websocket:close",
          lastSeenAt: new Date().toISOString(),
        });
      }
    });

    socket.on("error", () => {
      const state = socketStates.get(connectionId);
      disconnectSocket(connectionId);
      const hasActiveBrowserSocket = Array.from(socketStates.values()).some((s) => s.role === "browser");
      const summary = extensionStatusStore.readSummary();
      if (state?.role === "browser" && summary.detected && !hasActiveBrowserSocket) {
        extensionStatusStore.write({
          extensionId: summary.extensionId,
          browserTransport: "websocket",
          socketConnected: false,
          source: "websocket:error",
          lastSeenAt: new Date().toISOString(),
        });
      }
    });
  });

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/team-metadata") {
      sendJson(response, 200, loadTeamMetadata(root));
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, browserTransport: "websocket", studio: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/studio/git-activity") {
      sendJson(response, 200, getGitActivity());
      return;
    }

    // --- Studio routes (static files + API) ---
    if (await handleStudioRoute(request, response)) {
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

    if (request.method === "GET" && url.pathname === "/job-card") {
      const sessionId = url.searchParams.get("sessionId");
      const feed = jobCardStore.readAll();
      if (sessionId) {
        const card = jobCardStore.readBySession(sessionId);
        if (!card) {
          sendNoContent(response);
          return;
        }

        sendJson(response, 200, card);
        return;
      }

      sendJson(response, 200, feed);
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
        const deletedCard = jobCardStore.deleteBySession(sessionId);
        if (!selection) {
          sendNoContent(response);
          return;
        }

        if (deletedCard) {
          publishJobCard(deletedCard, "selection-session-delete", true);
        }

        sendJson(response, 200, selection);
        return;
      }

      if (request.method === "POST" && url.pathname === "/dev-selection") {
        const selection = selectionStore.write(await readJsonBody(request));
        writeJobCardFromSelection(selection, "selection-write");
        sendJson(response, 200, selection);
        return;
      }

      if (request.method === "POST" && url.pathname === "/job-card") {
        const payload = await readJsonBody(request);
        const selection =
          typeof payload?.sessionId === "string" && payload.sessionId.trim()
            ? selectionStore.readSession(payload.sessionId.trim())
            : null;
        const cardFromSelection = selection ? buildJobCardFromSelection(selection) : null;
        const preserveUpdatedAt = payload?.preserveUpdatedAt === true;
        const card = jobCardStore.write(
          {
            ...cardFromSelection,
            ...payload,
            target: payload?.target ?? cardFromSelection?.target ?? null,
            anchor: payload?.anchor ?? cardFromSelection?.anchor ?? null,
            position: payload?.position ?? cardFromSelection?.position ?? null,
            updatedAt: preserveUpdatedAt ? undefined : new Date().toISOString(),
          },
          {
            id: cardFromSelection?.id ?? payload?.id ?? null,
            sessionId: cardFromSelection?.sessionId ?? payload?.sessionId ?? null,
            selectionId: cardFromSelection?.selectionId ?? payload?.selectionId ?? null,
            target: cardFromSelection?.target ?? null,
            anchor: cardFromSelection?.anchor ?? null,
            position: cardFromSelection?.position ?? null,
            createdAt: cardFromSelection?.createdAt ?? payload?.createdAt ?? null,
            author: cardFromSelection?.author ?? payload?.author ?? null,
            requestMessage: cardFromSelection?.requestMessage ?? payload?.requestMessage ?? null,
            resultMessage: cardFromSelection?.resultMessage ?? payload?.resultMessage ?? null,
            message: cardFromSelection?.message ?? payload?.message ?? null,
            status: cardFromSelection?.status ?? payload?.status ?? null,
          },
        );
        if (card?.sessionId) {
          selectionStore.syncJobForSession(card.sessionId, card);
        }
        publishJobCard(card, "job-card-write", false);
        sendJson(response, 200, card);
        return;
      }

      if (request.method === "POST" && url.pathname === "/extension-status") {
        const payload = await readJsonBody(request);
        extensionStatusStore.write(payload);
        browserSessionStore.recordExtensionHeartbeat(payload);
        sendJson(response, 200, extensionStatusStore.readSummary());
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/job-card") {
        const sessionId = url.searchParams.get("sessionId");
        const card = sessionId ? jobCardStore.deleteBySession(sessionId) : null;
        if (!card) {
          sendNoContent(response);
          return;
        }

        if (card.sessionId) {
          selectionStore.syncJobForSession(card.sessionId, null);
        }
        publishJobCard(card, "job-card-delete", true);
        sendJson(response, 200, card);
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

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    studioViteServer = await createViteServer({
      root: studioAppRoot,
      appType: "spa",
      clearScreen: false,
      server: {
        middlewareMode: true,
        hmr: {
          server,
          protocol: "ws",
          host,
          clientPort: port,
          path: STUDIO_DEV_HMR_CLIENT_PATH,
        },
      },
    });
    studioDevDelegate = createConnectMiddlewareDelegate(studioViteServer.middlewares);
  }

  handleStudioRoute = createStudioRouteHandler({
    staticDir: studioStaticDir,
    statsStore,
    sceneStore: store,
    agentStateManager,
    teamStatusStore,
    contentStore,
    trendStore,
    experimentStore,
    experimentPipeline,
    memoStore,
    teamConfigStore,
    studioWsEvents,
    agentHistoryStore,
    dispatchBroker,
    studioUiStateStore,
    workspaceRoot,
    teamConfigRuntime,
    claudeUsagePoller,
    studioDevDelegate,
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

    if (!isProduction && url.pathname === STUDIO_DEV_HMR_UPGRADE_PATH) {
      return;
    }

    // Studio WebSocket endpoint for dashboard/office clients
    if (url.pathname === "/studio/ws") {
      socketServer.handleUpgrade(request, socket, head, (websocket) => {
        studioSocketClients.add(websocket);
        websocket.on("close", () => studioSocketClients.delete(websocket));
        websocket.on("error", () => studioSocketClients.delete(websocket));
        studioWsEvents.addClient(websocket);
        websocket.on("message", (rawMessage) => {
          try {
            const message = readSocketJson(rawMessage);
            if (message?.type === "ping") {
              sendSocketJson(websocket, { type: "pong" });
              return;
            }
            if (message?.type === "kuma-studio:layout-update") {
              broadcastOfficeLayout(message.layout, "studio-layout-drag");
            }
          } catch {
            // Ignore malformed studio client messages.
          }
        });
        sendSocketJson(websocket, {
          type: "kuma-studio:event",
          event: { kind: "stats-snapshot", stats: statsStore.getStats() },
        });
        sendSocketJson(websocket, {
          type: "kuma-studio:event",
          event: { kind: "office-layout-update", layout: store.readOfficeLayout() },
        });
        sendSocketJson(websocket, {
          type: "kuma-studio:team-status-update",
          snapshot: toStudioTeamStatusSnapshot(teamStatusStore.getSurfaceStates()),
        });
        sendSocketJson(websocket, {
          type: "kuma-studio:nightmode",
          enabled: isNightModeEnabled(),
        });
        sendSocketJson(websocket, {
          type: "kuma-studio:event",
          event: { kind: "claude-usage", snapshot: claudeUsagePoller.getSnapshot() },
        });
        void readPlans()
          .then((snapshot) => {
            sendSocketJson(websocket, {
              type: "kuma-studio:plans-update",
              snapshot,
            });
          })
          .catch(() => {
            // Initial plans snapshot is best-effort only.
          });
      });
      return;
    }

    if (url.pathname !== "/browser-session/socket") {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (websocket) => {
      socketServer.emit("connection", websocket, request);
    });
  });

  server.on("close", () => {
    stopWatching();
    stopWatchingPlans();
    claudeUsagePoller.stop();
    stopWatchingExplorer();
    teamConfigWatcher.close();
    if (extensionWatcher) {
      extensionWatcher.close();
    }
    clearTimeout(extensionReloadDebounce);
    clearInterval(pingInterval);
    clearInterval(inFlightCommandCleanupInterval);
    stopGitActivityPolling();
    socketServer.close();
    statsStore.close();
    teamStatusStore.close();
    teamConfigRuntime.close?.();
    void studioViteServer?.close();
  });

  return { server, store };
}
