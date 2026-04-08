import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { ContentStore } from "./content-store.mjs";
import { createExperimentRouteHandler } from "./experiment-routes.mjs";
import { ExperimentStore } from "./experiment-store.mjs";
import { TrendStore } from "./trend-store.mjs";

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

  it("handles completed status, generates report markdown, and creates a research-result card", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-experiments-"));
    tempDirs.push(root);

    const experimentStore = new ExperimentStore(root);
    const contentStore = new ContentStore(root);
    const trendStore = new TrendStore(root);
    const trend = trendStore.write({
      feedUrl: "https://example.com/feed.xml",
      articleUrl: "https://example.com/agent-sdk",
      title: "OpenAI Agent SDK ships",
      summary: "A new SDK for agent orchestration.",
      publishedAt: "2026-04-08T09:00:00+09:00",
      tags: ["agents", "sdk"],
      relevanceScore: 0.95,
    });
    const sourceContent = contentStore.write({
      project: "kuma-studio",
      type: "text",
      title: "Agent SDK research candidate",
      body: "Should we wire this SDK into the studio automation loop?",
      assignee: "darami",
      sourceTrendId: trend.id,
      sourceLinks: ["https://example.com/agent-sdk"],
      researchSuggestion: true,
      researchScore: 0.86,
    });
    const experiment = experimentStore.write({
      title: "Agent SDK rollout",
      source: "ai-trend",
      status: "in-progress",
      sourceContentId: sourceContent.id,
      sourceTrendId: trend.id,
      branch: "exp/agent-sdk-rollout",
      worktree: "/tmp/worktree-agent-sdk",
      researchScore: 0.86,
    });
    const handler = createExperimentRouteHandler({
      experimentStore,
      contentStore,
      trendStore,
      pipeline: {
        finalize() {
          return {
            pr_url: "https://example.com/pr/42",
            thread_draft: "draft body",
          };
        },
        cleanup() {
          return { branch: null, worktree: null };
        },
        start() {
          return { branch: "exp/test", worktree: "/tmp/worktree-test" };
        },
      },
    });

    const completeRes = createResponse();
    await handler(
      createRequest("POST", `/studio/experiments/${experiment.id}/status`, {
        status: "completed",
        researchQuestion: "이 SDK를 kuma-studio 자동화 루프에 붙이면 어떤 이득이 있나?",
        resultSummary: "실험 결과 agent orchestration path를 워크트리 실험에 바로 연결할 수 있었다.",
      }),
      completeRes,
      new URL(`http://localhost:4312/studio/experiments/${experiment.id}/status`),
    );

    assert.strictEqual(completeRes.statusCode, 200);
    assert.strictEqual(completeRes.json.status, "success");
    assert.strictEqual(completeRes.json.pr_url, "https://example.com/pr/42");
    assert.ok(typeof completeRes.json.resultContentId === "string");
    assert.include(completeRes.json.reportMarkdown, "## 연구 질문");
    assert.include(completeRes.json.reportMarkdown, "https://example.com/pr/42");

    const resultCard = contentStore.readByExperimentId(completeRes.json.id);
    assert.ok(resultCard);
    assert.strictEqual(resultCard.type, "research-result");
    assert.include(resultCard.body, "PR 링크: https://example.com/pr/42");
    assert.strictEqual(resultCard.sourceTrendId, trend.id);
    assert.strictEqual(contentStore.readById(sourceContent.id)?.type, "text");

    const reportRes = createResponse();
    await handler(
      createRequest("POST", `/studio/experiments/${experiment.id}/report`, {}),
      reportRes,
      new URL(`http://localhost:4312/studio/experiments/${experiment.id}/report`),
    );

    assert.strictEqual(reportRes.statusCode, 200);
    assert.include(reportRes.json.reportSummary, "트렌드 원본: OpenAI Agent SDK ships");
    assert.include(reportRes.json.reportMarkdown, "## PR 링크");
    assert.strictEqual(reportRes.json.experiment.resultContentId, resultCard.id);
  });
});
