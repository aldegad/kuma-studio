import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { createStudioRouteHandler } from "./studio-routes.mjs";

const tempRoots = [];

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
    body: Buffer.alloc(0),
  };

  return {
    writeHead(statusCode) {
      state.statusCode = statusCode;
    },
    end(body) {
      state.body = body ? Buffer.from(body) : Buffer.alloc(0);
    },
    get statusCode() {
      return state.statusCode;
    },
    get json() {
      return state.body.length > 0 ? JSON.parse(state.body.toString("utf8")) : null;
    },
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("studio-routes decision endpoints", () => {
  it("appends a decision through the injected runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-decisions-route-"));
    tempRoots.push(root);
    const vaultDir = join(root, "vault");
    const calls = [];
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      decisionRuntime: {
        async appendDecision(input) {
          calls.push(["append", input]);
          return { ok: true, id: "decision-1" };
        },
        async listOpenDecisions() {
          return { ledger: [], inbox: [] };
        },
        async resolveDecision() {
          return { ok: true };
        },
        async promoteToLedger() {
          return { ok: true };
        },
      },
    });

    const res = createResponse();
    await handler(createRequest("POST", "/studio/decisions/append", {
      vaultDir,
      layer: "inbox",
      entry: {
        action: "approve",
        scope: "project:kuma-studio",
        writer: "kuma-detect",
        original_text: "이걸로 가",
        context_ref: "turn-1",
      },
    }), res);

    assert.strictEqual(res.statusCode, 201);
    assert.deepStrictEqual(res.json, { ok: true, id: "decision-1" });
    assert.deepStrictEqual(calls, [[
      "append",
      {
        vaultDir,
        entry: {
          action: "approve",
          scope: "project:kuma-studio",
          writer: "kuma-detect",
          layer: "inbox",
          original_text: "이걸로 가",
          context_ref: "turn-1",
        },
      },
    ]]);
  });

  it("lists open decisions from the injected runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-decisions-route-"));
    tempRoots.push(root);
    const vaultDir = join(root, "vault");
    const calls = [];
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      decisionRuntime: {
        async appendDecision() {
          return { ok: true };
        },
        async listOpenDecisions(input) {
          calls.push(input);
          return {
            ledger: [{ id: "decision-1", action: "hold" }],
            inbox: [{ id: "inbox-1", action: "approve" }],
          };
        },
        async resolveDecision() {
          return { ok: true };
        },
        async promoteToLedger() {
          return { ok: true };
        },
      },
    });

    const res = createResponse();
    await handler(
      createRequest("GET", `/studio/decisions/open?vaultDir=${encodeURIComponent(vaultDir)}`),
      res,
    );

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, {
      decisions: {
        ledger: [{ id: "decision-1", action: "hold" }],
        inbox: [{ id: "inbox-1", action: "approve" }],
      },
    });
    assert.deepStrictEqual(calls, [{ vaultDir }]);
  });

  it("resolves a decision by id through the injected runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-decisions-route-"));
    tempRoots.push(root);
    const vaultDir = join(root, "vault");
    const calls = [];
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      decisionRuntime: {
        async appendDecision() {
          return { ok: true };
        },
        async listOpenDecisions() {
          return { ledger: [], inbox: [] };
        },
        async resolveDecision(input) {
          calls.push(input);
          return { ok: true, resolved: "decision-7" };
        },
        async promoteToLedger() {
          return { ok: true };
        },
      },
    });

    const res = createResponse();
    await handler(createRequest("POST", "/studio/decisions/resolve", {
      vaultDir,
      id: "decision-7",
    }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, { ok: true, resolved: "decision-7" });
    assert.deepStrictEqual(calls, [{ vaultDir, id: "decision-7" }]);
  });

  it("promotes an inbox decision through the injected runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-decisions-route-"));
    tempRoots.push(root);
    const vaultDir = join(root, "vault");
    const calls = [];
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      decisionRuntime: {
        async appendDecision() {
          return { ok: true };
        },
        async listOpenDecisions() {
          return { ledger: [], inbox: [] };
        },
        async resolveDecision() {
          return { ok: true };
        },
        async promoteToLedger(input) {
          calls.push(input);
          return { inboxId: "inbox-7", ledgerId: "ledger-3" };
        },
      },
    });

    const res = createResponse();
    await handler(createRequest("POST", "/studio/decisions/promote", {
      vaultDir,
      inboxId: "inbox-7",
      resolvedText: "앞으로는 plan body 인용을 ledger 로 승격하지 않는다.",
      writer: "user-direct",
      contextRef: "task:demo",
    }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, { inboxId: "inbox-7", ledgerId: "ledger-3" });
    assert.deepStrictEqual(calls, [{
      vaultDir,
      inboxId: "inbox-7",
      resolvedText: "앞으로는 plan body 인용을 ledger 로 승격하지 않는다.",
      writer: "user-direct",
      contextRef: "task:demo",
    }]);
  });
});
