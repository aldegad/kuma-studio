import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { DispatchBroker } from "./dispatch-broker.mjs";
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

describe("studio-routes dispatch endpoints", () => {
  it("registers, reads, and updates a dispatch through the broker routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-dispatch-route-"));
    tempRoots.push(root);
    const taskFile = join(root, "demo.task.md");
    const resultFile = join(root, "demo.result.md");
    await writeFile(taskFile, "---\nid: demo-task\nproject: kuma-studio\ninitiator: surface:1\nworker: surface:4\nqa: worker-self-report\nresult: " + resultFile + "\nsignal: demo-task-done\n---\n\n# demo\n\nImplement fix\n", "utf8");

    const broker = new DispatchBroker({
      storagePath: join(root, "dispatch-broker.json"),
    });
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      dispatchBroker: broker,
    });

    const registerRes = createResponse();
    await handler(createRequest("POST", "/studio/dispatches", {
      taskId: "demo-task",
      taskFile,
      project: "kuma-studio",
      initiator: "surface:1",
      initiatorLabel: "쿠마",
      worker: "surface:4",
      workerId: "tookdaki",
      workerName: "뚝딱이",
      workerType: "codex",
      qa: "worker-self-report",
      resultFile,
      signal: "demo-task-done",
      instruction: "Implement fix",
      summary: "Implement fix",
    }), registerRes);
    assert.strictEqual(registerRes.statusCode, 200);
    assert.strictEqual(registerRes.json.dispatch.status, "dispatched");
    assert.strictEqual(registerRes.json.dispatch.messages.length, 1);
    assert.strictEqual(registerRes.json.dispatch.messages[0].bodySource, "forwarded-summary");
    assert.strictEqual(registerRes.json.dispatch.messages[0].fromLabel, "쿠마");
    assert.strictEqual(registerRes.json.dispatch.messages[0].toLabel, "뚝딱이");

    const statusRes = createResponse();
    await handler(createRequest("GET", "/studio/dispatches/demo-task"), statusRes);
    assert.strictEqual(statusRes.statusCode, 200);
    assert.strictEqual(statusRes.json.dispatch.taskId, "demo-task");

    const messageRes = createResponse();
    await handler(createRequest("POST", "/studio/dispatches/demo-task/messages", {
      kind: "question",
      text: "Can Kuma confirm the expected output?",
      bodySource: "lifecycle-event",
      from: "worker",
      to: "initiator",
      fromLabel: "뚝딱이",
      toLabel: "쿠마",
      fromSurface: "surface:4",
      toSurface: "surface:1",
    }), messageRes);
    assert.strictEqual(messageRes.statusCode, 200);
    assert.strictEqual(messageRes.json.dispatch.messages.length, 2);
    assert.strictEqual(messageRes.json.dispatch.messages[1].bodySource, "lifecycle-event");
    assert.strictEqual(messageRes.json.dispatch.messages[1].fromLabel, "뚝딱이");
    assert.strictEqual(messageRes.json.dispatch.messages[1].toLabel, "쿠마");

    const listMessagesRes = createResponse();
    await handler(createRequest("GET", "/studio/dispatches/demo-task/messages"), listMessagesRes);
    assert.strictEqual(listMessagesRes.statusCode, 200);
    assert.strictEqual(listMessagesRes.json.messages.length, 2);

    const eventRes = createResponse();
    await handler(createRequest("POST", "/studio/dispatches/demo-task/events", {
      type: "complete",
      source: "worker",
    }), eventRes);
    assert.strictEqual(eventRes.statusCode, 200);
    assert.strictEqual(eventRes.json.dispatch.status, "qa-passed");
  });
});
