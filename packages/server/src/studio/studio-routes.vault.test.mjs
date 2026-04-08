import { Readable } from "node:stream";

import { assert, describe, it } from "vitest";

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
    get headers() {
      return state.headers;
    },
  };
}

describe("studio-routes vault", () => {
  it("redirects legacy /studio/wiki paths to /studio/vault", async () => {
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
    });

    const res = createResponse();
    await handler(
      createRequest("POST", "/studio/wiki/inbox", {
        title: "원문",
        text: "raw payload",
      }),
      res,
    );

    assert.strictEqual(res.statusCode, 307);
    assert.strictEqual(res.headers.Location, "/studio/vault/inbox");
  });

  it("uses addInbox for /studio/vault/inbox", async () => {
    const calls = [];
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      memoStore: {
        async addInbox(input) {
          calls.push({ type: "addInbox", input });
          return {
            id: "inbox/test.md",
            path: "inbox/test.md",
            title: input.title,
            text: input.text,
            images: [],
            createdAt: "2026-04-07T00:00:00.000Z",
            source: "vault",
            section: "inbox",
          };
        },
        async add() {
          calls.push({ type: "add" });
          return null;
        },
      },
    });

    const res = createResponse();
    await handler(
      createRequest("POST", "/studio/vault/inbox", {
        title: "원문",
        text: "raw payload",
      }),
      res,
    );

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], {
      type: "addInbox",
      input: {
        title: "원문",
        text: "raw payload",
      },
    });
    assert.strictEqual(res.json.section, "inbox");
  });

  it("runs vault skill sync via /studio/vault/sync-skills", async () => {
    const calls = [];
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      memoStore: {
        getVaultDir() {
          return "/tmp/test-vault";
        },
      },
      vaultSkillSyncFn: async (input) => {
        calls.push(input);
        return {
          skillsSynced: 3,
          created: 2,
          updated: 1,
          deleted: 0,
        };
      },
    });

    const res = createResponse();
    await handler(createRequest("POST", "/studio/vault/sync-skills"), res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(calls, [{ vaultDir: "/tmp/test-vault" }]);
    assert.strictEqual(res.json.skillsSynced, 3);
    assert.strictEqual(res.json.created, 2);
  });

  it("/studio/memos returns only legacy memos without inbox", async () => {
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      memoStore: {
        async list() {
          return [{ id: "doc.md", title: "Doc", images: [], createdAt: "2026-04-07T00:00:00.000Z" }];
        },
        async listMemos() {
          return [{ id: "legacy/memo.md", title: "Memo", images: [], createdAt: "2026-04-07T00:00:00.000Z", source: "legacy-memo" }];
        },
        async listInbox() {
          return [{ id: "inbox/raw.md", title: "Raw", images: [], createdAt: "2026-04-07T00:00:00.000Z" }];
        },
      },
    });

    const res = createResponse();
    await handler(
      createRequest("GET", "/studio/memos"),
      res,
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.memos[0].id, "legacy/memo.md");
    assert.strictEqual(res.json.memos[0].source, "legacy-memo");
    assert.strictEqual(res.json.inbox, undefined);
  });
});
