import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { ContentStore } from "./content-store.mjs";
import { createContentRouteHandler } from "./content-routes.mjs";

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

describe("content-routes", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("supports content CRUD and status updates", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-content-routes-"));
    tempDirs.push(root);

    const handler = createContentRouteHandler({
      contentStore: new ContentStore(root),
      workspaceRoot: root,
    });

    const createRes = createResponse();
    await handler(
      createRequest("POST", "/studio/content", {
        project: "kuma-studio",
        type: "text",
        title: "첫 콘텐츠",
        body: "초안 본문",
        assignee: "tookdaki",
      }),
      createRes,
      new URL("http://localhost:4312/studio/content"),
    );

    assert.strictEqual(createRes.statusCode, 201);
    assert.strictEqual(createRes.json.title, "첫 콘텐츠");
    assert.strictEqual(createRes.json.assignee, "tookdaki");
    const itemId = createRes.json.id;

    const listRes = createResponse();
    await handler(
      createRequest("GET", "/studio/contents?project=kuma-studio&assignee=tookdaki"),
      listRes,
      new URL("http://localhost:4312/studio/contents?project=kuma-studio&assignee=tookdaki"),
    );

    assert.strictEqual(listRes.statusCode, 200);
    assert.strictEqual(listRes.json.items.length, 1);

    const patchRes = createResponse();
    await handler(
      createRequest("PATCH", `/studio/content/${itemId}`, {
        title: "수정된 콘텐츠",
        scheduledFor: "2026-04-06T09:00:00+09:00",
        assignee: null,
      }),
      patchRes,
      new URL(`http://localhost:4312/studio/content/${itemId}`),
    );

    assert.strictEqual(patchRes.statusCode, 200);
    assert.strictEqual(patchRes.json.title, "수정된 콘텐츠");
    assert.ok(typeof patchRes.json.scheduledFor === "string");
    assert.strictEqual(patchRes.json.assignee, null);

    const unassignedRes = createResponse();
    await handler(
      createRequest("GET", "/studio/content?assignee=unassigned"),
      unassignedRes,
      new URL("http://localhost:4312/studio/content?assignee=unassigned"),
    );

    assert.strictEqual(unassignedRes.statusCode, 200);
    assert.strictEqual(unassignedRes.json.items.length, 1);

    const statusRes = createResponse();
    await handler(
      createRequest("POST", `/studio/content/${itemId}/status`, {
        status: "ready",
      }),
      statusRes,
      new URL(`http://localhost:4312/studio/content/${itemId}/status`),
    );

    assert.strictEqual(statusRes.statusCode, 200);
    assert.strictEqual(statusRes.json.status, "ready");

    const deleteRes = createResponse();
    await handler(
      createRequest("DELETE", `/studio/content/${itemId}`),
      deleteRes,
      new URL(`http://localhost:4312/studio/content/${itemId}`),
    );

    assert.strictEqual(deleteRes.statusCode, 200);
    assert.strictEqual(deleteRes.json.id, itemId);

    const finalListRes = createResponse();
    await handler(
      createRequest("GET", "/studio/content"),
      finalListRes,
      new URL("http://localhost:4312/studio/content"),
    );

    assert.strictEqual(finalListRes.json.items.length, 0);
  });

  it("rejects invalid assignee values", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-content-routes-"));
    tempDirs.push(root);

    const handler = createContentRouteHandler({
      contentStore: new ContentStore(root),
      workspaceRoot: root,
    });

    const createRes = createResponse();
    await handler(
      createRequest("POST", "/studio/content", {
        project: "kuma-studio",
        type: "text",
        title: "잘못된 담당자",
        body: "본문",
        assignee: "not-a-member",
      }),
      createRes,
      new URL("http://localhost:4312/studio/content"),
    );

    assert.strictEqual(createRes.statusCode, 400);

    const listRes = createResponse();
    await handler(
      createRequest("GET", "/studio/content?assignee=not-a-member"),
      listRes,
      new URL("http://localhost:4312/studio/content?assignee=not-a-member"),
    );

    assert.strictEqual(listRes.statusCode, 400);
  });
});
