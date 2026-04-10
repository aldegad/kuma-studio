import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterEach, assert, describe, it } from "vitest";

import { TeamConfigStore, watchTeamConfig } from "./team-config-store.mjs";
import { createStudioRouteHandler, createTeamConfigRuntime } from "./studio-routes.mjs";
import { createTeamConfigWatcherHandler } from "./team-config-watcher.mjs";

const CMUX_SPAWN_SCRIPT_PATH = fileURLToPath(new URL("../../../../scripts/cmux/kuma-cmux-spawn.sh", import.meta.url));

async function waitFor(assertion, timeoutMs = 4_000) {
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

function writeExecutable(path, content) {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

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
            spawnModel: "gpt-5.4-mini",
            spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
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

function createFakeCmuxEnvironment(root, tempDirs) {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const logPath = join(root, "cmux.log");
  const cmuxPath = join(binDir, "cmux");

  writeExecutable(
    cmuxPath,
    `#!/bin/bash
set -euo pipefail
LOG_FILE="\${FAKE_CMUX_LOG:?}"
printf '%s\\n' "$*" >> "$LOG_FILE"
cmd="\${1:-}"
shift || true
case "$cmd" in
  new-split|new-surface)
    workspace=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --workspace) workspace="$2"; shift 2 ;;
        --surface|--pane) shift 2 ;;
        *) shift ;;
      esac
    done
    if [ -z "$workspace" ]; then
      workspace="workspace:9"
    fi
    printf 'surface:123 %s\\n' "$workspace"
    ;;
  send|send-key)
    ;;
  read-screen)
    printf 'worker output delivered\\n'
    ;;
  tab-action)
    if [ "\${FAKE_CMUX_RENAME_FAIL:-0}" = "1" ]; then
      echo "rename failed" >&2
      exit 1
    fi
    ;;
  *)
    ;;
esac
`,
  );

  const teamJsonPath = join(root, "team.json");
  writeFileSync(teamJsonPath, `${JSON.stringify(createMinimalTeamSchema(), null, 2)}\n`, "utf8");

  return {
    binDir,
    logPath,
    teamJsonPath,
    spawnEnv(extra = {}) {
      return {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_CMUX_LOG: logPath,
        KUMA_TEAM_JSON_PATH: teamJsonPath,
        KUMA_SKIP_AGENT_STATE_NOTIFY: "1",
        ...extra,
      };
    },
  };
}

function createRequest(method, url, body) {
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
  req.url = url;
  req.headers = { host: "localhost:4312" };
  return req;
}

function createResponse() {
  const state = {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
  };

  return {
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    end(body) {
      state.body = body ? Buffer.from(body) : Buffer.alloc(0);
    },
    get json() {
      return state.body.length > 0 ? JSON.parse(state.body.toString("utf8")) : null;
    },
    get statusCode() {
      return state.statusCode;
    },
  };
}

describe("studio-routes team-config", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("returns a busy warning unless force is set, then updates and respawns", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const store = new TeamConfigStore(join(root, "team.json"));
    const broadcasts = [];
    const respawns = [];

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      teamStatusStore: {
        getSnapshot() {
          return {
            projects: {
              "kuma-studio": {
                members: [
                  {
                    name: "쿠마",
                    emoji: "🐻",
                    role: "총괄 리더",
                    surface: "surface:1",
                    status: "working",
                    lastOutput: "Delegating tasks",
                  },
                ],
              },
            },
          };
        },
      },
      teamConfigStore: store,
      studioWsEvents: {
        broadcastTeamConfigChanged(payload) {
          broadcasts.push(payload);
        },
      },
      teamConfigRuntime: {
        resolveMemberContext() {
          return { project: "system", surface: "surface:1" };
        },
        async respawnMember(input) {
          respawns.push(input);
          return { project: input.project, surface: "surface:99" };
        },
      },
      workspaceRoot: root,
    });

    const warningRes = createResponse();
    await handler(
      createRequest("PATCH", "/studio/team-config/kuma", {
        type: "codex",
      }),
      warningRes,
      new URL("http://localhost:4312/studio/team-config/kuma"),
    );

    assert.strictEqual(warningRes.statusCode, 409);
    assert.strictEqual(warningRes.json.requiresForce, true);
    assert.strictEqual(respawns.length, 0);

    const patchRes = createResponse();
    await handler(
      createRequest("PATCH", "/studio/team-config/kuma", {
        type: "codex",
        force: true,
      }),
      patchRes,
      new URL("http://localhost:4312/studio/team-config/kuma"),
    );

    assert.strictEqual(patchRes.statusCode, 200);
    assert.strictEqual(patchRes.json.member, "쿠마");
    assert.strictEqual(patchRes.json.surface, "surface:99");
    assert.strictEqual(store.getConfig().members["쿠마"].type, "codex");
    assert.strictEqual(respawns.length, 1);
    assert.strictEqual(broadcasts.length, 1);
  });

  it("serves the full team config snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const store = new TeamConfigStore(join(root, "team.json"));
    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      teamConfigStore: store,
      workspaceRoot: root,
    });

    const res = createResponse();
    await handler(
      createRequest("GET", "/studio/team-config"),
      res,
      new URL("http://localhost:4312/studio/team-config"),
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.members["쿠마"].id, "kuma");
    assert.strictEqual(res.json.members["뚝딱이"].type, "codex");
  });

  it("queues working member respawns and persists queue plus log files", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-runtime-"));
    tempDirs.push(root);

    const queuePath = join(root, "queue", "respawns.json");
    const logPath = join(root, "logs", "team-watcher.log");
    const runtime = createTeamConfigRuntime({
      teamStatusStore: {
        getSnapshot() {
          return {
            projects: {
              system: {
                members: [
                  {
                    name: "쿠마",
                    status: "working",
                  },
                ],
              },
            },
          };
        },
      },
      queuePath,
      logPath,
      queuePollMs: 0,
    });

    try {
      const result = runtime.respawnMember({
        memberName: "쿠마",
        memberConfig: {
          id: "kuma",
          emoji: "🐻",
          team: "system",
          type: "codex",
        },
        project: "system",
        currentSurface: "surface:1",
        workspaceRoot: root,
      });

      assert.deepStrictEqual(result, {
        project: "system",
        surface: "surface:1",
        queued: true,
      });
      assert.strictEqual(existsSync(queuePath), true);
      assert.strictEqual(existsSync(logPath), true);

      const queue = JSON.parse(readFileSync(queuePath, "utf8"));
      assert.strictEqual(queue.kuma.memberName, "쿠마");
      assert.strictEqual(queue.kuma.currentSurface, "surface:1");

      const log = readFileSync(logPath, "utf8");
      assert.match(log, /RESPAWN_QUEUED: member=쿠마 surface=surface:1 status=working/u);
    } finally {
      runtime.close();
    }
  });

  it("suppresses watcher re-respawn for the same PATCH self-write", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
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
      resolveWorkspaceForSurfaceFn: () => "workspace:2",
      resolvePaneForSurfaceFn: () => "pane:4",
      spawnRunner(scriptPath, args) {
        spawnCalls.push({ scriptPath, args });
        return { status: 0, stdout: "surface:87\n", stderr: "", error: null };
      },
      killRunner() {},
    });
    const watcher = watchTeamConfig({
      configPath,
      debounceMs: 50,
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
          model: "gpt-5.4",
        }),
        res,
        new URL("http://localhost:4312/studio/team-config/bamdori"),
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.surface, "surface:87");

      await waitFor(() => broadcasts.some((payload) => payload.source === "watcher"));

      assert.strictEqual(spawnCalls.length, 1);
      const watcherPayload = broadcasts.find((payload) => payload.source === "watcher");
      assert.ok(watcherPayload);
      assert.deepStrictEqual(watcherPayload.respawns, []);
      assert.ok(watcherLogs.some((line) => line.includes("TEAM_CONFIG_SELF_WRITE_SUPPRESSED: member=밤토리 id=bamdori")));
    } finally {
      watcher.close();
      runtime.close();
    }
  });

  it("keeps self-write suppression alive until a slow respawn finishes", () => {
    const runtime = createTeamConfigRuntime({
      queuePollMs: 0,
      selfWriteTtlMs: 10,
    });

    try {
      const patchShape = {
        id: "bamdori",
        type: "codex",
        model: "gpt-5.4",
        options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="medium"',
      };
      const watcherShape = {
        id: "bamdori",
        spawnType: "codex",
        spawnModel: "gpt-5.4",
        spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="medium"',
      };

      runtime.registerPendingSelfWrite({ memberId: "bamdori", memberConfig: patchShape });
      sleepSync(50);
      runtime.settlePendingSelfWrite("bamdori");

      assert.strictEqual(
        runtime.consumePendingSelfWrite({ memberId: "bamdori", memberConfig: watcherShape }),
        true,
      );
    } finally {
      runtime.close();
    }
  });

  it("converges the registry to a single canonical member->surface mapping after respawn", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const registryPath = join(root, "surfaces.json");
    const queuePath = join(root, "queue.json");
    const logPath = join(root, "team-watcher.log");
    writeFileSync(configPath, `${JSON.stringify(createMinimalTeamSchema(), null, 2)}\n`, "utf8");
    writeFileSync(
      registryPath,
      `${JSON.stringify({
        "kuma-studio": {
          "🦔 밤토리": "surface:74",
          "밤토리": "surface:12",
        },
        other: {
          "🦔 밤토리": "surface:33",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new TeamConfigStore(configPath);
    const runtime = createTeamConfigRuntime({
      teamConfigStore: store,
      teamStatusStore: createIdleTeamStatusStore(),
      registryPath,
      queuePath,
      logPath,
      queuePollMs: 0,
      resolveWorkspaceForSurfaceFn: () => "workspace:2",
      resolvePaneForSurfaceFn: () => "pane:4",
      spawnRunner() {
        return { status: 0, stdout: "surface:87\n", stderr: "", error: null };
      },
      killRunner() {},
    });

    try {
      const handler = createStudioRouteHandler({
        staticDir: join(root, "static"),
        statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
        sceneStore: {},
        teamStatusStore: createIdleTeamStatusStore(),
        teamConfigStore: store,
        teamConfigRuntime: runtime,
        workspaceRoot: root,
      });

      const res = createResponse();
      await handler(
        createRequest("PATCH", "/studio/team-config/bamdori", {
          model: "gpt-5.4",
        }),
        res,
        new URL("http://localhost:4312/studio/team-config/bamdori"),
      );

      assert.strictEqual(res.statusCode, 200);

      const nextRegistry = JSON.parse(readFileSync(registryPath, "utf8"));
      assert.deepStrictEqual(nextRegistry, {
        "kuma-studio": {
          "🦔 밤토리": "surface:87",
        },
      });
    } finally {
      runtime.close();
    }
  });

  it("spawns the exact codex command with model and options for 밤토리", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-cmux-spawn-"));
    tempDirs.push(root);

    const fakeCmux = createFakeCmuxEnvironment(root);
    const result = spawnSync(
      "bash",
      [
        String(CMUX_SPAWN_SCRIPT_PATH),
        "밤토리",
        "",
        root,
        "kuma-studio",
        "--workspace",
        "workspace:9",
        "--pane",
        "pane:3",
      ],
      {
        encoding: "utf8",
        env: fakeCmux.spawnEnv(),
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /surface:123/u);

    const log = readFileSync(fakeCmux.logPath, "utf8");
    assert.match(log, /send --workspace workspace:9 --surface surface:123/u);
    assert.match(log, /KUMA_ROLE=worker codex -m gpt-5\.4-mini/u);
    assert.match(log, /--dangerously-bypass-approvals-and-sandbox/u);
    assert.match(log, /-c service_tier=fast/u);
    assert.match(log, /-c model_reasoning_effort="xhigh"/u);
  }, 10_000);

  it("passes workspace and title to tab rename and surfaces rename failures on stderr", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-cmux-spawn-"));
    tempDirs.push(root);

    const fakeCmux = createFakeCmuxEnvironment(root);
    const result = spawnSync(
      "bash",
      [
        String(CMUX_SPAWN_SCRIPT_PATH),
        "밤토리",
        "",
        root,
        "kuma-studio",
        "--workspace",
        "workspace:9",
        "--pane",
        "pane:3",
      ],
      {
        encoding: "utf8",
        env: fakeCmux.spawnEnv({ FAKE_CMUX_RENAME_FAIL: "1" }),
      },
    );

    assert.strictEqual(result.status, 0);
    const log = readFileSync(fakeCmux.logPath, "utf8");
    assert.match(log, /tab-action --action rename --workspace workspace:9 --surface surface:123 --title 🦔 밤토리/u);
    assert.match(result.stderr, /TITLE_RENAME_FAILED: member=밤토리 surface=surface:123 workspace=workspace:9/u);
  }, 10_000);

  it("returns cleanupFailed in the PATCH payload when old surface cleanup throws", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const registryPath = join(root, "surfaces.json");
    const queuePath = join(root, "queue.json");
    const logPath = join(root, "team-watcher.log");
    writeFileSync(configPath, `${JSON.stringify(createMinimalTeamSchema(), null, 2)}\n`, "utf8");
    writeFileSync(registryPath, `${JSON.stringify({ "kuma-studio": { "🦔 밤토리": "surface:74" } }, null, 2)}\n`, "utf8");

    const store = new TeamConfigStore(configPath);
    const runtime = createTeamConfigRuntime({
      teamConfigStore: store,
      teamStatusStore: createIdleTeamStatusStore(),
      registryPath,
      queuePath,
      logPath,
      queuePollMs: 0,
      resolveWorkspaceForSurfaceFn: () => "workspace:2",
      resolvePaneForSurfaceFn: () => "pane:4",
      spawnRunner() {
        return {
          status: 0,
          stdout: "surface:87\n",
          stderr: "TITLE_RENAME_FAILED: member=밤토리 surface=surface:87 workspace=workspace:2\n",
          error: null,
        };
      },
      killRunner() {
        throw new Error("close-surface failed");
      },
    });

    try {
      const handler = createStudioRouteHandler({
        staticDir: join(root, "static"),
        statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
        sceneStore: {},
        teamStatusStore: createIdleTeamStatusStore(),
        teamConfigStore: store,
        teamConfigRuntime: runtime,
        workspaceRoot: root,
      });

      const res = createResponse();
      await handler(
        createRequest("PATCH", "/studio/team-config/bamdori", {
          model: "gpt-5.4",
        }),
        res,
        new URL("http://localhost:4312/studio/team-config/bamdori"),
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.surface, "surface:87");
      assert.strictEqual(res.json.cleanupFailed, true);
      assert.match(res.json.cleanupError, /close-surface failed/u);

      const log = readFileSync(logPath, "utf8");
      assert.match(log, /TITLE_RENAME_FAILED: member=밤토리 surface=surface:87 workspace=workspace:2/u);
      assert.match(log, /RESPAWN_CLEANUP_FAILED: member=밤토리 surface=surface:74 details=close-surface failed/u);
    } finally {
      runtime.close();
    }
  });
});
