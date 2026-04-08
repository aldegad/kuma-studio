import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { ContentStore } from "./content-store.mjs";
import { ExperimentStore } from "./experiment-store.mjs";
import { TrendStore } from "./trend-store.mjs";
import { createTrendRouteHandler } from "./trend-routes.mjs";

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

describe("trend-routes", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("persists trend items and creates linked content cards", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-trend-routes-"));
    tempDirs.push(root);

    const trendStore = new TrendStore(root);
    const contentStore = new ContentStore(root);
    const handler = createTrendRouteHandler({ trendStore, contentStore });

    const ingestRes = createResponse();
    await handler(
      createRequest("POST", "/studio/trends/ingest", {
        project: "kuma-studio",
        items: [
          {
            feedUrl: "https://example.com/feed.xml",
            articleUrl: "https://example.com/ai-agents",
            title: "AI agents trend",
            summary: "새로운 에이전트 프레임워크가 빠르게 늘고 있다.",
            publishedAt: "2026-04-08T09:00:00+09:00",
            tags: ["ai", "agents"],
            relevanceScore: 0.91,
          },
        ],
      }),
      ingestRes,
      new URL("http://localhost:4312/studio/trends/ingest"),
    );

    assert.strictEqual(ingestRes.statusCode, 200);
    assert.strictEqual(ingestRes.json.trends.length, 1);
    assert.strictEqual(ingestRes.json.items.length, 1);
    assert.strictEqual(ingestRes.json.items[0].sourceTrendId, ingestRes.json.trends[0].id);
    assert.deepStrictEqual(ingestRes.json.items[0].sourceLinks, [
      "https://example.com/ai-agents",
      "https://example.com/feed.xml",
    ]);
    assert.strictEqual(ingestRes.json.items[0].body, "새로운 에이전트 프레임워크가 빠르게 늘고 있다.");

    const repeatRes = createResponse();
    await handler(
      createRequest("POST", "/studio/trends/ingest", [
        {
          feedUrl: "https://example.com/feed.xml",
          articleUrl: "https://example.com/ai-agents",
          title: "AI agents trend updated",
          summary: "업데이트된 요약",
          publishedAt: "2026-04-08T10:00:00+09:00",
          tags: ["ai", "automation"],
          relevanceScore: 0.95,
        },
      ]),
      repeatRes,
      new URL("http://localhost:4312/studio/trends/ingest"),
    );

    assert.strictEqual(repeatRes.statusCode, 200);
    assert.strictEqual(trendStore.list().length, 1);
    assert.strictEqual(contentStore.list().length, 1);
    assert.strictEqual(contentStore.list()[0].title, "AI agents trend updated");
    assert.strictEqual(contentStore.list()[0].body, "업데이트된 요약");
  });

  it("lists persisted trends", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-trend-routes-"));
    tempDirs.push(root);

    const trendStore = new TrendStore(root);
    const handler = createTrendRouteHandler({ trendStore, contentStore: new ContentStore(root) });

    trendStore.write({
      feedUrl: "https://example.com/feed.xml",
      articleUrl: "https://example.com/article-1",
      title: "Trend 1",
      summary: "Summary",
      publishedAt: "2026-04-08T09:00:00+09:00",
      tags: ["ai"],
      relevanceScore: 0.5,
    });

    const listRes = createResponse();
    await handler(
      createRequest("GET", "/studio/trends?feedUrl=https%3A%2F%2Fexample.com%2Ffeed.xml"),
      listRes,
      new URL("http://localhost:4312/studio/trends?feedUrl=https%3A%2F%2Fexample.com%2Ffeed.xml"),
    );

    assert.strictEqual(listRes.statusCode, 200);
    assert.strictEqual(listRes.json.items.length, 1);
    assert.strictEqual(listRes.json.items[0].feedUrl, "https://example.com/feed.xml");
  });

  it("updates trend settings and auto-starts research when enabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-trend-routes-"));
    tempDirs.push(root);

    const trendStore = new TrendStore(root);
    const contentStore = new ContentStore(root);
    const experimentStore = new ExperimentStore(root);
    const pipeline = {
      start(experiment) {
        return {
          branch: `exp/${experiment.id}`,
          worktree: `/tmp/${experiment.id}`,
        };
      },
    };
    const handler = createTrendRouteHandler({
      trendStore,
      contentStore,
      experimentStore,
      experimentPipeline: pipeline,
      nowFn: () => new Date("2026-04-08T06:00:00.000Z"),
    });

    const settingsRes = createResponse();
    await handler(
      createRequest("POST", "/studio/trends/settings", { autoResearch: true }),
      settingsRes,
      new URL("http://localhost:4312/studio/trends/settings"),
    );

    assert.strictEqual(settingsRes.statusCode, 200);
    assert.strictEqual(settingsRes.json.autoResearch, true);

    const ingestRes = createResponse();
    await handler(
      createRequest("POST", "/studio/trends/ingest", {
        project: "kuma-studio",
        items: [
          {
            feedUrl: "https://feed.example.com/1",
            articleUrl: "https://example.com/agent-sdk",
            title: "New agent SDK makes workflow automation easier",
            summary: "This release ships a new API, CLI, and open source library for agent orchestration.",
            publishedAt: "2026-04-08T00:00:00.000Z",
            tags: ["agents", "sdk", "automation"],
            relevanceScore: 0.91,
          },
        ],
      }),
      ingestRes,
      new URL("http://localhost:4312/studio/trends/ingest"),
    );

    assert.strictEqual(ingestRes.statusCode, 200);
    assert.strictEqual(ingestRes.json.items.length, 1);
    assert.strictEqual(ingestRes.json.items[0].researchSuggestion, true);
    assert.ok(ingestRes.json.items[0].researchScore >= 0.8);
    assert.ok(typeof ingestRes.json.items[0].experimentId === "string");
    assert.strictEqual(ingestRes.json.experiments.length, 1);
    assert.strictEqual(ingestRes.json.experiments[0].status, "in-progress");
    assert.strictEqual(contentStore.list()[0].experimentId, ingestRes.json.experiments[0].id);
  });
});
