import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { createExperimentRouteHandler } from "./experiment-routes.mjs";
import { ExperimentStore } from "./experiment-store.mjs";

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
  const state = { statusCode: null, body: Buffer.alloc(0) };
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

describe("experiment-routes", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("supports CRUD, settings, and status transitions", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-experiments-"));
    tempDirs.push(root);

    const pipeline = {
      start() {
        return { branch: "exp/test-1234", worktree: "/tmp/worktree-exp" };
      },
      finalize() {
        return { pr_url: "https://example.com/pr/1", thread_draft: "draft body" };
      },
      cleanup() {
        return { branch: null, worktree: null };
      },
    };
    const handler = createExperimentRouteHandler({
      experimentStore: new ExperimentStore(root),
      pipeline,
    });

    const createRes = createResponse();
    await handler(
      createRequest("POST", "/studio/experiments", {
        title: "새 실험",
        source: "user-idea",
      }),
      createRes,
      new URL("http://localhost:4312/studio/experiments"),
    );
    assert.strictEqual(createRes.statusCode, 201);
    const experimentId = createRes.json.id;

    const statusRes = createResponse();
    await handler(
      createRequest("POST", `/studio/experiments/${experimentId}/status`, { status: "in-progress" }),
      statusRes,
      new URL(`http://localhost:4312/studio/experiments/${experimentId}/status`),
    );
    assert.strictEqual(statusRes.json.branch, "exp/test-1234");

    const successRes = createResponse();
    await handler(
      createRequest("POST", `/studio/experiments/${experimentId}/status`, { status: "success" }),
      successRes,
      new URL(`http://localhost:4312/studio/experiments/${experimentId}/status`),
    );
    assert.strictEqual(successRes.json.pr_url, "https://example.com/pr/1");

    const failedRes = createResponse();
    await handler(
      createRequest("POST", `/studio/experiments/${experimentId}/status`, { status: "failed" }),
      failedRes,
      new URL(`http://localhost:4312/studio/experiments/${experimentId}/status`),
    );
    assert.strictEqual(failedRes.json.branch, null);
    assert.strictEqual(failedRes.json.worktree, null);

    const settingsRes = createResponse();
    await handler(
      createRequest("POST", "/studio/experiments/settings", {
        trendFetchIntervalMinutes: 90,
        autoProposeTime: "08:30",
      }),
      settingsRes,
      new URL("http://localhost:4312/studio/experiments/settings"),
    );
    assert.strictEqual(settingsRes.json.trendFetchIntervalMinutes, 90);

    const deleteRes = createResponse();
    await handler(
      createRequest("DELETE", `/studio/experiments/${experimentId}`),
      deleteRes,
      new URL(`http://localhost:4312/studio/experiments/${experimentId}`),
    );
    assert.strictEqual(deleteRes.statusCode, 200);
  });
});
