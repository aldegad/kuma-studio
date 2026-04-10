import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, assert, describe, it } from "vitest";

import { TeamConfigStore, watchTeamConfig } from "./team-config-store.mjs";
import { createStudioRouteHandler, createTeamConfigRuntime } from "./studio-routes.mjs";
import { createTeamConfigWatcherHandler } from "./team-config-watcher.mjs";
import { buildTeamConfigSelfWriteHash, toCanonicalTeamConfigHashShape } from "./team-config-hash.mjs";

function createMinimalTeamSchema(overrides = {}) {
  return {
    teams: {
      dev: {
        name: "개발팀",
        members: [
          {
            id: "bamdori",
            name: "밤토리",
            emoji: "🦔",
            role: "QA",
            team: "dev",
            nodeType: "worker",
            spawnType: "codex",
            spawnModel: "gpt-5.4",
            spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="medium"',
            ...overrides,
          },
        ],
      },
    },
  };
}

function createIdleTeamStatusStore() {
  return {
    getSnapshot() {
      return {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "밤토리",
                emoji: "🦔",
                role: "QA",
                surface: "surface:74",
                status: "idle",
                lastOutput: "",
              },
            ],
          },
        },
      };
    },
  };
}

function createRequest(method, path, body = null) {
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
  const req = new Readable({
    read() {
      if (payload) {
        this.push(payload);
      }
      this.push(null);
    },
  });

  req.method = method;
  req.url = path;
  req.headers = { host: "localhost:4312" };
  return req;
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers);
    },
    end(chunk) {
      this.writableEnded = true;
      this.body = chunk ? String(chunk) : "";
      try {
        this.json = this.body ? JSON.parse(this.body) : null;
      } catch {
        this.json = null;
      }
    },
  };
}

async function waitFor(assertion, timeoutMs = 6_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return;
    }
    await delay(50);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe("team-config-watcher self-write integration", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("converges route and watcher member shapes into one canonical hash", () => {
    const routeShape = {
      id: "bamdori",
      type: "codex",
      model: "gpt-5.4",
      options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
    };
    const watcherShape = {
      id: "bamdori",
      name: "밤토리",
      emoji: "🦔",
      team: "dev",
      spawnType: "codex",
      spawnModel: "gpt-5.4",
      spawnOptions: '  --dangerously-bypass-approvals-and-sandbox   -c service_tier=fast  -c model_reasoning_effort="high"  ',
    };

    assert.deepStrictEqual(toCanonicalTeamConfigHashShape(routeShape), {
      type: "codex",
      model: "gpt-5.4",
      options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
    });
    assert.deepStrictEqual(toCanonicalTeamConfigHashShape(watcherShape), {
      type: "codex",
      model: "gpt-5.4",
      options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
    });
    assert.strictEqual(buildTeamConfigSelfWriteHash(routeShape), buildTeamConfigSelfWriteHash(watcherShape));
  });

  it("suppresses the fs.watch respawn path even when the PATCH respawn blocks the event loop", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-self-write-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const registryPath = join(root, "surfaces.json");
    const queuePath = join(root, "queue.json");
    const logPath = join(root, "team-watcher.log");
    writeFileSync(configPath, `${JSON.stringify(createMinimalTeamSchema(), null, 2)}\n`, "utf8");
    writeFileSync(registryPath, `${JSON.stringify({ "kuma-studio": { "🦔 밤토리": "surface:74" } }, null, 2)}\n`, "utf8");

    const store = new TeamConfigStore(configPath);
    const teamStatusStore = createIdleTeamStatusStore();
    const broadcasts = [];
    const watcherLogs = [];
    const spawnCalls = [];
    const runtime = createTeamConfigRuntime({
      teamConfigStore: store,
      teamStatusStore,
      registryPath,
      queuePath,
      logPath,
      queuePollMs: 0,
      selfWriteTtlMs: 3_000,
      resolveWorkspaceForSurfaceFn: () => "workspace:2",
      resolvePaneForSurfaceFn: () => "pane:4",
      spawnRunner(scriptPath, args) {
        spawnCalls.push({ scriptPath, args });
        sleepSync(1_500);
        return { status: 0, stdout: "surface:93\n", stderr: "", error: null };
      },
      killRunner() {},
    });

    const watcher = watchTeamConfig({
      configPath,
      debounceMs: 500,
      onChange: createTeamConfigWatcherHandler({
        teamConfigRuntime: runtime,
        studioWsEvents: {
          broadcastTeamConfigChanged(payload) {
            broadcasts.push(payload);
          },
        },
        workspaceRoot: root,
        appendLog(message) {
          watcherLogs.push(message);
        },
      }),
    });

    try {
      await delay(50);

      const handler = createStudioRouteHandler({
        staticDir: join(root, "static"),
        statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
        sceneStore: {},
        teamStatusStore,
        teamConfigStore: store,
        studioWsEvents: {
          broadcastTeamConfigChanged(payload) {
            broadcasts.push(payload);
          },
        },
        teamConfigRuntime: runtime,
        workspaceRoot: root,
      });

      const res = createResponse();
      await handler(
        createRequest("PATCH", "/studio/team-config/bamdori", {
          options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
          force: true,
        }),
        res,
        new URL("http://localhost:4312/studio/team-config/bamdori"),
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.surface, "surface:93");

      await waitFor(() => broadcasts.some((payload) => payload.source === "watcher"));

      const watcherPayload = broadcasts.find((payload) => payload.source === "watcher");
      assert.ok(watcherPayload);
      assert.deepStrictEqual(watcherPayload.respawns, []);
      assert.strictEqual(spawnCalls.length, 1);
      assert.ok(watcherLogs.some((line) => line.includes("TEAM_CONFIG_SELF_WRITE_SUPPRESSED: member=밤토리 id=bamdori")));
      assert.ok(!watcherLogs.some((line) => line.includes("TEAM_CONFIG_SELF_WRITE_MISS")));

      const runtimeLog = readFileSync(logPath, "utf8");
      assert.match(runtimeLog, /RESPAWN_APPLIED: member=밤토리 old=surface:74 new=surface:93 cleanupFailed=false/u);
    } finally {
      watcher.close();
      runtime.close();
    }
  });

  it("logs TEAM_CONFIG_SELF_WRITE_MISS when a pending self-write hash does not match", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-self-write-"));
    tempDirs.push(root);

    const registryPath = join(root, "surfaces.json");
    const queuePath = join(root, "queue.json");
    const logPath = join(root, "team-watcher.log");
    writeFileSync(registryPath, `${JSON.stringify({ "kuma-studio": { "🦔 밤토리": "surface:74" } }, null, 2)}\n`, "utf8");

    const watcherLogs = [];
    const runtime = createTeamConfigRuntime({
      teamStatusStore: createIdleTeamStatusStore(),
      registryPath,
      queuePath,
      logPath,
      queuePollMs: 0,
      resolveWorkspaceForSurfaceFn: () => "workspace:2",
      resolvePaneForSurfaceFn: () => "pane:4",
      spawnRunner() {
        return { status: 0, stdout: "surface:95\n", stderr: "", error: null };
      },
      killRunner() {},
    });

    runtime.registerPendingSelfWrite({
      memberId: "bamdori",
      memberConfig: {
        id: "bamdori",
        type: "codex",
        model: "gpt-5.4",
        options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
      },
    });
    runtime.settlePendingSelfWrite("bamdori");

    const handler = createTeamConfigWatcherHandler({
      teamConfigRuntime: runtime,
      studioWsEvents: {
        broadcastTeamConfigChanged() {},
      },
      workspaceRoot: root,
      appendLog(message) {
        watcherLogs.push(message);
      },
    });

    try {
      await handler({
        changedIds: ["bamdori"],
        diff: { added: [], removed: [], updated: ["bamdori"] },
        previousMembers: {},
        currentMembers: {
          bamdori: {
            id: "bamdori",
            name: "밤토리",
            emoji: "🦔",
            team: "dev",
            spawnType: "codex",
            spawnModel: "gpt-5.4",
            spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="medium"',
          },
        },
      });

      assert.ok(watcherLogs.some((line) => line.includes("TEAM_CONFIG_SELF_WRITE_MISS: member=밤토리 id=bamdori")));
    } finally {
      runtime.close();
    }
  });
});
