import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { TeamConfigStore } from "./team-config-store.mjs";
import { createStudioRouteHandler } from "./studio-routes.mjs";

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
});
