import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { DispatchBroker } from "./dispatch-broker.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createBroker() {
  const root = await mkdtemp(join(tmpdir(), "kuma-dispatch-broker-"));
  tempRoots.push(root);
  const hookCalls = [];
  const storagePath = join(root, "dispatch-broker.json");
  const broker = new DispatchBroker({
    storagePath,
    async runLifecycleHook(input) {
      hookCalls.push(input);
    },
  });
  return { root, storagePath, broker, hookCalls };
}

function demoDispatch(overrides = {}) {
  return {
    taskId: "demo-20260411-120000",
    taskFile: "/tmp/demo.task.md",
    project: "kuma-studio",
    initiator: "surface:1",
    initiatorLabel: "쿠마",
    worker: "surface:4",
    workerId: "tookdaki",
    workerName: "뚝딱이",
    workerType: "codex",
    qa: "surface:7",
    qaMember: "밤토리",
    qaSurface: "surface:7",
    resultFile: "/tmp/demo.result.md",
    signal: "demo-20260411-120000-done",
    instruction: "Implement the dispatch broker",
    summary: "Implement the dispatch broker",
    ...overrides,
  };
}

describe("dispatch-broker", () => {
  it("registers dispatches, persists them, and loads them again", async () => {
    const { storagePath, broker, hookCalls } = await createBroker();
    await broker.registerDispatch(demoDispatch());

    const stored = JSON.parse(await readFile(storagePath, "utf8"));
    expect(stored.dispatches).toHaveLength(1);
    expect(stored.dispatches[0].taskId).toBe("demo-20260411-120000");
    expect(stored.dispatches[0].messages).toHaveLength(1);
    expect(stored.dispatches[0].messages[0]).toMatchObject({
      kind: "instruction",
      text: "Implement the dispatch broker",
      bodySource: "forwarded-summary",
      from: "initiator",
      to: "worker",
      fromLabel: "쿠마",
      toLabel: "뚝딱이",
      source: "kuma-task",
    });
    expect(hookCalls.map((entry) => entry.event)).toEqual(["dispatched"]);

    const reloaded = new DispatchBroker({ storagePath });
    expect(reloaded.getDispatch("demo-20260411-120000")?.status).toBe("dispatched");
    expect(reloaded.getDispatch("demo-20260411-120000")?.messages).toHaveLength(1);
  });

  it("appends threaded dispatch messages and preserves them across reloads", async () => {
    const { storagePath, broker } = await createBroker();
    await broker.registerDispatch(demoDispatch({
      instruction: "Implement the dispatch broker and keep conversation history.",
    }));

    const updated = await broker.appendMessage("demo-20260411-120000", {
      kind: "question",
      text: "Need clarification on the QA path.",
      from: "worker",
      to: "initiator",
      fromLabel: "뚝딱이",
      toLabel: "쿠마",
      fromSurface: "surface:4",
      toSurface: "surface:1",
      source: "kuma-dispatch",
    });

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1]).toMatchObject({
      kind: "question",
      text: "Need clarification on the QA path.",
      bodySource: "direct-message",
      from: "worker",
      to: "initiator",
      fromLabel: "뚝딱이",
      toLabel: "쿠마",
    });

    const reloaded = new DispatchBroker({ storagePath });
    expect(reloaded.listMessages("demo-20260411-120000")).toHaveLength(2);
  });

  it("keeps QA tasks in worker-done until qa-pass arrives", async () => {
    const { broker, hookCalls } = await createBroker();
    await broker.registerDispatch(demoDispatch());

    const workerDone = await broker.reportEvent("demo-20260411-120000", {
      type: "complete",
      source: "worker",
    });
    expect(workerDone.status).toBe("worker-done");

    const passed = await broker.reportEvent("demo-20260411-120000", {
      type: "qa-pass",
      note: "QA PASS",
      source: "bamdori",
    });
    expect(passed.status).toBe("qa-passed");
    expect(hookCalls.map((entry) => entry.event)).toEqual(["dispatched", "worker-done", "qa-passed"]);
  });

  it("auto-closes worker-self-report tasks on complete", async () => {
    const { broker, hookCalls } = await createBroker();
    await broker.registerDispatch(demoDispatch({
      taskId: "self-20260411-120001",
      qa: "worker-self-report",
      qaMember: "",
      qaSurface: "",
    }));

    const completed = await broker.reportEvent("self-20260411-120001", {
      type: "complete",
      source: "worker",
    });

    expect(completed.status).toBe("qa-passed");
    expect(hookCalls.map((entry) => entry.event)).toEqual(["dispatched", "worker-done", "qa-passed"]);
  });

  it("ignores late completion events after a dispatch already reached a terminal state", async () => {
    const { broker, hookCalls } = await createBroker();
    await broker.registerDispatch(demoDispatch());

    await broker.reportEvent("demo-20260411-120000", {
      type: "complete",
      source: "worker",
    });
    const passed = await broker.reportEvent("demo-20260411-120000", {
      type: "qa-pass",
      note: "QA PASS",
      source: "bamdori",
    });
    expect(passed.status).toBe("qa-passed");

    const lateComplete = await broker.reportEvent("demo-20260411-120000", {
      type: "complete",
      source: "worker",
    });
    expect(lateComplete.status).toBe("qa-passed");
    expect(lateComplete.lastEvent).toBe("qa-pass");
    expect(hookCalls.map((entry) => entry.event)).toEqual(["dispatched", "worker-done", "qa-passed"]);
  });
});
