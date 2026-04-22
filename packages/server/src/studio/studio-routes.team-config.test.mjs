import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterEach, assert, describe, expect, it } from "vitest";

import { TeamConfigStore, watchTeamConfig } from "./team-config-store.mjs";
import { createStudioRouteHandler } from "./studio-routes.mjs";
import { createTeamConfigRuntime } from "./team-config-runtime.mjs";
import { createTeamConfigWatcherHandler } from "./team-config-watcher.mjs";

const CMUX_SPAWN_SCRIPT_PATH = fileURLToPath(new URL("../../../../scripts/cmux/kuma-cmux-spawn.sh", import.meta.url));
const CMUX_TEAM_CONFIG_SCRIPT_PATH = fileURLToPath(new URL("../../../../scripts/cmux/kuma-cmux-team-config.sh", import.meta.url));
const DECISIONS_FIXTURE = `---
title: Decisions
type: special/decisions
updated: 2026-04-13T01:00:00+09:00
boot_priority: 3
---

## About

fixture

## Decisions

- 에이전트 이름과 결정사항은 startup/system prompt에 직접 넣는다.
`;

const PROJECT_DECISIONS_FIXTURE = `---
title: kuma-studio Project Decisions
type: special/project-decisions
project: kuma-studio
updated: 2026-04-13T01:10:00+09:00
boot_priority: 3
---

## About

fixture

## Decisions

- decision 사항이 프롬프트에도 들어가야 해.
- 프로젝트 결정은 project-decisions에서 읽는다.
`;

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

function writeDecisionsFixture(root) {
  const vaultDir = join(root, "vault");
  mkdirSync(join(vaultDir, "projects"), { recursive: true });
  writeFileSync(join(vaultDir, "decisions.md"), DECISIONS_FIXTURE, "utf8");
  writeFileSync(join(vaultDir, "projects", "kuma-studio.project-decisions.md"), PROJECT_DECISIONS_FIXTURE, "utf8");
  return vaultDir;
}

function createMinimalTeamSchema(overrides = {}) {
  const { teams, ...memberOverrides } = overrides;
  if (teams) {
    return { teams };
  }

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
            roleLabel: {
              ko: "QA",
              en: "CoS. Bash execution, cmux worker management",
            },
            skills: ["kuma-picker"],
            team: "dev",
            nodeType: "worker",
            spawnType: "codex",
            spawnModel: "gpt-5.4-mini",
            spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
            ...memberOverrides,
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

function createFakeCmuxEnvironment(root, teamSchema = createMinimalTeamSchema()) {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const logPath = join(root, "cmux.log");
  const readCountPath = join(root, "read-count.txt");
  const cmuxPath = join(binDir, "cmux");
  writeFileSync(readCountPath, "0", "utf8");

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
    count=$(cat "${readCountPath}")
    count=$((count + 1))
    printf '%s' "$count" > "${readCountPath}"
    if [ "$count" -eq 1 ]; then
      printf '❯\\n'
    else
      printf 'worker output delivered\\n'
    fi
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
  writeFileSync(teamJsonPath, `${JSON.stringify(teamSchema, null, 2)}\n`, "utf8");

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
    assert.strictEqual(respawns[0].deferIfWorking, false);
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

  it("renders the exact codex developer instructions through the prompt viewer route", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const vaultDir = writeDecisionsFixture(root);
    const projectRoot = join(root, "kuma-studio");
    mkdirSync(projectRoot, { recursive: true });
    const teamPath = join(root, "team.json");
    writeFileSync(teamPath, `${JSON.stringify(createMinimalTeamSchema(), null, 2)}\n`, "utf8");

    const store = new TeamConfigStore(teamPath);
    const previousVaultDir = process.env.KUMA_VAULT_DIR;
    process.env.KUMA_VAULT_DIR = vaultDir;

    try {
      const handler = createStudioRouteHandler({
        staticDir,
        statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
        sceneStore: {},
        teamConfigStore: store,
        workspaceRoot: projectRoot,
      });

      const expected = spawnSync(
        "bash",
        ["-lc", `source "${CMUX_TEAM_CONFIG_SCRIPT_PATH}" && build_codex_developer_instructions "밤토리" "CoS. Bash execution, cmux worker management" "worker" "kuma-studio"`],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            KUMA_TEAM_JSON_PATH: teamPath,
            KUMA_VAULT_DIR: vaultDir,
          },
        },
      );

      assert.strictEqual(expected.status, 0);

      const res = createResponse();
      await handler(
        createRequest("GET", "/studio/team-prompts/bamdori?project=kuma-studio"),
        res,
        new URL("http://localhost:4312/studio/team-prompts/bamdori?project=kuma-studio"),
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.member, "밤토리");
      assert.strictEqual(res.json.type, "codex");
      assert.strictEqual(res.json.project, "kuma-studio");
      assert.strictEqual(res.json.prompt, expected.stdout);
    } finally {
      if (previousVaultDir == null) {
        delete process.env.KUMA_VAULT_DIR;
      } else {
        process.env.KUMA_VAULT_DIR = previousVaultDir;
      }
    }
  });

  it("renders the exact Kuma session system prompt using the workspace project fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const vaultDir = writeDecisionsFixture(root);
    const projectRoot = join(root, "kuma-studio");
    mkdirSync(projectRoot, { recursive: true });
    const sessionPromptPath = join(root, "kuma-session-prompt.md");
    writeFileSync(sessionPromptPath, "You are Kuma session prompt fixture.", "utf8");
    const teamPath = join(root, "team.json");
    writeFileSync(teamPath, `${JSON.stringify({
      teams: {
        system: {
          members: [
            {
              id: "kuma",
              name: "쿠마",
              emoji: "🐻",
              role: "총괄 리더",
              roleLabel: { en: "Leader" },
              team: "system",
              nodeType: "session",
              spawnType: "claude",
              spawnModel: "claude-opus-4-6",
              spawnOptions: "--dangerously-skip-permissions",
            },
          ],
        },
      },
    }, null, 2)}\n`, "utf8");

    const store = new TeamConfigStore(teamPath);
    const previousVaultDir = process.env.KUMA_VAULT_DIR;
    const previousSystemPromptPath = process.env.KUMA_SYSTEM_PROMPT_PATH;
    process.env.KUMA_VAULT_DIR = vaultDir;
    process.env.KUMA_SYSTEM_PROMPT_PATH = sessionPromptPath;

    try {
      const handler = createStudioRouteHandler({
        staticDir,
        statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
        sceneStore: {},
        teamConfigStore: store,
        workspaceRoot: projectRoot,
      });

      const expected = spawnSync(
        "bash",
        ["-lc", `source "${CMUX_TEAM_CONFIG_SCRIPT_PATH}" && build_session_system_prompt "쿠마" "Leader" "session" "kuma-studio"`],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            KUMA_TEAM_JSON_PATH: teamPath,
            KUMA_VAULT_DIR: vaultDir,
            KUMA_SYSTEM_PROMPT_PATH: sessionPromptPath,
          },
        },
      );

      assert.strictEqual(expected.status, 0);

      const res = createResponse();
      await handler(
        createRequest("GET", "/studio/team-prompts/kuma?project=system"),
        res,
        new URL("http://localhost:4312/studio/team-prompts/kuma?project=system"),
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.member, "쿠마");
      assert.strictEqual(res.json.project, "kuma-studio");
      assert.strictEqual(res.json.nodeType, "session");
      assert.strictEqual(res.json.prompt, expected.stdout);
      assert.match(res.json.prompt, /You are Kuma session prompt fixture\./u);
      assert.match(res.json.prompt, /프로젝트 결정은 project-decisions에서 읽는다\./u);
    } finally {
      if (previousVaultDir == null) {
        delete process.env.KUMA_VAULT_DIR;
      } else {
        process.env.KUMA_VAULT_DIR = previousVaultDir;
      }

      if (previousSystemPromptPath == null) {
        delete process.env.KUMA_SYSTEM_PROMPT_PATH;
      } else {
        process.env.KUMA_SYSTEM_PROMPT_PATH = previousSystemPromptPath;
      }
    }
  });

  it("applies explicit modelCatalogId patches without collapsing back to raw model defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const store = new TeamConfigStore(join(root, "team.json"));
    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      teamStatusStore: createIdleTeamStatusStore(),
      teamConfigStore: store,
      teamConfigRuntime: {
        resolveMemberContext() {
          return { project: "kuma-studio", surface: "surface:74" };
        },
        async respawnMember(input) {
          return { project: input.project, surface: input.currentSurface ?? "surface:74" };
        },
      },
      workspaceRoot: root,
    });

    const res = createResponse();
    await handler(
      createRequest("PATCH", "/studio/team-config/bamdori", {
        type: "codex",
        modelCatalogId: "gpt-5.4-high-fast",
      }),
      res,
      new URL("http://localhost:4312/studio/team-config/bamdori"),
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(store.getConfig().members["밤토리"].modelCatalogId, "gpt-5.4-high-fast");
    assert.strictEqual(store.getConfig().members["밤토리"].model, "gpt-5.4");
    assert.match(store.getConfig().members["밤토리"].options, /model_reasoning_effort="high"/u);
    assert.match(store.getConfig().members["밤토리"].options, /service_tier=fast/u);
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
      resolveLiveMemberSurfacesFn: () => [],
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
      resolveLiveMemberSurfacesFn: () => [],
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
      resolveLiveMemberSurfacesFn: () => [],
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
      resolveLiveMemberSurfacesFn: () => [],
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

  it("kills the previous surface before spawning the replacement surface", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-runtime-"));
    tempDirs.push(root);

    const registryPath = join(root, "surfaces.json");
    writeFileSync(registryPath, `${JSON.stringify({ "kuma-studio": { "🦔 밤토리": "surface:74" } }, null, 2)}\n`, "utf8");

    const calls = [];
    const runtime = createTeamConfigRuntime({
      registryPath,
      queuePollMs: 0,
      resolveLiveMemberSurfacesFn: () => [],
      resolveWorkspaceForSurfaceFn: () => "workspace:2",
      resolvePaneForSurfaceFn: () => "pane:4",
      killRunner(_scriptPath, surface) {
        calls.push(`kill:${surface}`);
      },
      spawnRunner(_scriptPath, args) {
        calls.push(`spawn:${args[0]}`);
        return { status: 0, stdout: "surface:87\n", stderr: "", error: null };
      },
    });

    try {
      const result = runtime.respawnMember({
        memberName: "밤토리",
        memberConfig: {
          id: "bamdori",
          emoji: "🦔",
          team: "dev",
          type: "codex",
        },
        project: "kuma-studio",
        currentSurface: "surface:74",
        workspaceRoot: root,
      });

      assert.deepStrictEqual(calls, ["kill:surface:74", "spawn:🦔 밤토리"]);
      assert.strictEqual(result.surface, "surface:87");
    } finally {
      runtime.close();
    }
  });

  it("falls back to live cmux surfaces for system member respawn when the registry misses", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-runtime-"));
    tempDirs.push(root);

    const registryPath = join(root, "surfaces.json");
    writeFileSync(registryPath, `${JSON.stringify({ system: { "🐻 쿠마": "surface:1" } }, null, 2)}\n`, "utf8");

    const calls = [];
    const runtime = createTeamConfigRuntime({
      registryPath,
      queuePollMs: 0,
      resolveLiveMemberSurfacesFn: () => ["surface:24", "surface:25"],
      resolveWorkspaceForSurfaceFn: () => "workspace:5",
      resolvePaneForSurfaceFn: () => "pane:9",
      killRunner(_scriptPath, surface) {
        calls.push(`kill:${surface}`);
      },
      spawnRunner(_scriptPath, args) {
        calls.push(`spawn:${args.join(" ")}`);
        return { status: 0, stdout: "surface:26\n", stderr: "", error: null };
      },
    });

    try {
      const result = runtime.respawnMember({
        memberName: "노을이",
        memberConfig: {
          id: "noeuri",
          emoji: "🦌",
          team: "system",
          type: "claude",
        },
        project: "system",
        workspaceRoot: root,
      });

      assert.deepStrictEqual(calls, [
        "kill:surface:24",
        "kill:surface:25",
        "spawn:🦌 노을이 claude " + root + " system --workspace workspace:5 --pane pane:9",
      ]);
      assert.deepStrictEqual(result, {
        project: "system",
        surface: "surface:26",
        cleanupFailed: false,
        cleanupError: null,
        queued: false,
      });
      assert.deepStrictEqual(JSON.parse(readFileSync(registryPath, "utf8")), {
        system: {
          "🐻 쿠마": "surface:1",
          "🦌 노을이": "surface:26",
        },
      });
    } finally {
      runtime.close();
    }
  });

  it("canonicalizes stale project-scoped system members back into the system registry", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-runtime-"));
    tempDirs.push(root);

    const registryPath = join(root, "surfaces.json");
    writeFileSync(registryPath, `${JSON.stringify({
      "kuma-studio": {
        "🦌 노을이": "surface:24",
      },
      system: {
        "🐻 쿠마": "surface:1",
      },
    }, null, 2)}\n`, "utf8");

    const runtime = createTeamConfigRuntime({
      registryPath,
      queuePollMs: 0,
      resolveLiveMemberSurfacesFn: () => [],
    });

    try {
      const context = runtime.resolveMemberContext("노을이", "🦌", "kuma-studio", "system");

      assert.deepStrictEqual(context, {
        project: "system",
        label: "🦌 노을이",
        surface: "surface:24",
      });
      assert.deepStrictEqual(JSON.parse(readFileSync(registryPath, "utf8")), {
        system: {
          "🐻 쿠마": "surface:1",
          "🦌 노을이": "surface:24",
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
      ["-lc", `source "${CMUX_TEAM_CONFIG_SCRIPT_PATH}" && build_member_command "밤토리" "" "${root}"`],
      {
        encoding: "utf8",
        env: fakeCmux.spawnEnv(),
      },
    );

    assert.strictEqual(result.status, 0);
    const command = result.stdout;
    assert.match(command, /KUMA_ROLE=worker codex -m gpt-5\.4-mini/u);
    assert.match(command, /developer_instructions=/u);
    assert.match(command, /밤토리야\./u);
    assert.match(command, /CoS\..*cmux worker management/u);
    assert.match(command, /Wait for dispatched task/u);
    assert.match(command, /--dangerously-bypass-approvals-and-sandbox/u);
    assert.match(command, /-c service_tier=fast/u);
    assert.match(command, /-c model_reasoning_effort="xhigh"/u);
    expect(command).not.toMatch(/model_reasoning_effort="xhigh" CoS/u);
    expect(command).not.toContain('"/kuma-picker"');
    expect(command).not.toContain('-- "/kuma-picker"');
  }, 30_000);

  it("spawns a system codex worker with member identity in developer instructions", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-cmux-spawn-"));
    tempDirs.push(root);
    const vaultDir = writeDecisionsFixture(root);
    const projectRoot = join(root, "kuma-studio");
    mkdirSync(projectRoot, { recursive: true });

    const fakeCmux = createFakeCmuxEnvironment(
      root,
      createMinimalTeamSchema({
        teams: {
          system: {
            name: "시스템",
            members: [
              {
                id: "noeuri",
                name: "노을이",
                emoji: "🦌",
                role: "vault-manager",
                roleLabel: {
                  ko: "Vault 큐레이터",
                  en: "Vault Curator. Knowledge management, curation, sync",
                },
                skills: ["kuma-vault"],
                team: "system",
                nodeType: "worker",
                spawnType: "codex",
                spawnModel: "gpt-5.4-mini",
                spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
              },
            ],
          },
        },
      }),
    );
    const result = spawnSync(
      "bash",
      ["-lc", `source "${CMUX_TEAM_CONFIG_SCRIPT_PATH}" && build_member_command "노을이" "" "${projectRoot}"`],
      {
        encoding: "utf8",
        env: fakeCmux.spawnEnv({ KUMA_VAULT_DIR: vaultDir }),
      },
    );

    assert.strictEqual(result.status, 0);
    const command = result.stdout;
    assert.match(command, /KUMA_ROLE=worker codex -m gpt-5\.4-mini/u);
    assert.match(command, /노을이야\./u);
    assert.match(command, /Vault Curator\./u);
    assert.match(command, /Decisions Boot Pack:/u);
    assert.match(command, /에이전트 이름과 결정사항은 startup\/system prompt에 직접 넣는다\./u);
  }, 30_000);

  it("spawns the exact claude command with member identity in the startup prompt", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-cmux-spawn-"));
    tempDirs.push(root);
    const vaultDir = writeDecisionsFixture(root);
    const projectRoot = join(root, "kuma-studio");
    mkdirSync(projectRoot, { recursive: true });

    const fakeCmux = createFakeCmuxEnvironment(
      root,
      createMinimalTeamSchema({
        id: "koon",
        name: "쿤",
        emoji: "🦝",
        role: "ui",
        roleLabel: {
          ko: "퍼블리셔/디자이너",
          en: "Publisher / Designer. HTML/CSS/Graphics",
        },
        skills: ["frontend-design"],
        team: "dev",
        nodeType: "worker",
        spawnType: "claude",
        spawnModel: "claude-opus-4-6",
        spawnOptions: "--dangerously-skip-permissions",
      }),
    );
    const result = spawnSync(
      "bash",
      ["-lc", `source "${CMUX_TEAM_CONFIG_SCRIPT_PATH}" && build_member_command "쿤" "" "${projectRoot}"`],
      {
        encoding: "utf8",
        env: fakeCmux.spawnEnv({ KUMA_VAULT_DIR: vaultDir }),
      },
    );

    assert.strictEqual(result.status, 0);
    const command = result.stdout;
    const promptFile = command.match(/--append-system-prompt-file\s+(\S+)/u)?.[1] ?? "";
    assert.match(command, /KUMA_ROLE=worker claude --model claude-opus-4-6/u);
    assert.match(command, /--append-system-prompt-file/u);
    assert.ok(promptFile);
    const startupPrompt = readFileSync(promptFile, "utf8");
    assert.match(startupPrompt, /쿤야\./u);
    assert.match(startupPrompt, /Publisher \/ Designer\./u);
    assert.match(startupPrompt, /Decisions Boot Pack:/u);
    assert.match(startupPrompt, /decision 사항이 프롬프트에도 들어가야 해\./u);
    assert.match(startupPrompt, /Do not respond unless there is a startup problem\./u);
    expect(command).not.toMatch(/Decisions Boot Pack:/u);
  }, 30_000);

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
  }, 30_000);

  it("fails the PATCH without spawning a replacement when old surface cleanup throws", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-routes-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const registryPath = join(root, "surfaces.json");
    const queuePath = join(root, "queue.json");
    const logPath = join(root, "team-watcher.log");
    writeFileSync(configPath, `${JSON.stringify(createMinimalTeamSchema(), null, 2)}\n`, "utf8");
    writeFileSync(registryPath, `${JSON.stringify({ "kuma-studio": { "🦔 밤토리": "surface:74" } }, null, 2)}\n`, "utf8");

    const store = new TeamConfigStore(configPath);
    let spawnCalls = 0;
    const runtime = createTeamConfigRuntime({
      teamConfigStore: store,
      teamStatusStore: createIdleTeamStatusStore(),
      registryPath,
      queuePath,
      logPath,
      queuePollMs: 0,
      resolveLiveMemberSurfacesFn: () => [],
      resolveWorkspaceForSurfaceFn: () => "workspace:2",
      resolvePaneForSurfaceFn: () => "pane:4",
      spawnRunner() {
        spawnCalls += 1;
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

      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(spawnCalls, 0);
      assert.match(res.json.error, /Failed to respawn member with the updated team config\./u);
      assert.match(res.json.details, /close-surface failed/u);

      const log = readFileSync(logPath, "utf8");
      assert.match(log, /RESPAWN_CLEANUP_FAILED: member=밤토리 surface=surface:74 details=close-surface failed/u);
    } finally {
      runtime.close();
    }
  });
});
