import { assert, describe, it } from "vitest";

import { scoreTrendForResearch } from "./trend-research-scorer.mjs";

describe("trend-research-scorer", () => {
  it("scores fresh implementation trends highly enough for auto start", () => {
    const score = scoreTrendForResearch({
      trend: {
        id: "trend-1",
        feedUrl: "https://feed.example.com/1",
        articleUrl: "https://example.com/agent-sdk",
        title: "New agent SDK makes workflow automation easier",
        summary: "This release ships a new API, CLI, and open source library for agent orchestration.",
        tags: ["agents", "sdk", "automation"],
        publishedAt: "2026-04-08T00:00:00.000Z",
      },
      allTrends: [
        {
          id: "trend-1",
          feedUrl: "https://feed.example.com/1",
          articleUrl: "https://example.com/agent-sdk",
          title: "New agent SDK makes workflow automation easier",
          summary: "This release ships a new API, CLI, and open source library for agent orchestration.",
          tags: ["agents", "sdk", "automation"],
          publishedAt: "2026-04-08T00:00:00.000Z",
        },
        {
          id: "trend-2",
          feedUrl: "https://feed.example.com/2",
          articleUrl: "https://example.com/agent-sdk-2",
          title: "Agent SDK rollout speeds up workflow automation",
          summary: "Another API launch for automation teams.",
          tags: ["agents", "sdk"],
          publishedAt: "2026-04-08T01:00:00.000Z",
        },
      ],
      existingExperiments: [],
      now: new Date("2026-04-08T06:00:00.000Z"),
    });

    assert.ok(score.score >= 0.8);
    assert.strictEqual(score.suggestion, true);
    assert.strictEqual(score.autoStart, true);
    assert.ok(score.context.matchedKeywords.includes("api"));
  });

  it("reduces novelty when a similar experiment already exists", () => {
    const score = scoreTrendForResearch({
      trend: {
        id: "trend-1",
        feedUrl: "https://feed.example.com/1",
        articleUrl: "https://example.com/agent-sdk",
        title: "Agent SDK orchestration stack for production teams",
        summary: "A production agent framework release.",
        tags: ["agents", "sdk"],
        publishedAt: "2026-04-01T00:00:00.000Z",
      },
      allTrends: [],
      existingExperiments: [
        {
          title: "Agent SDK orchestration stack for production",
        },
      ],
      now: new Date("2026-04-08T06:00:00.000Z"),
    });

    assert.ok(score.breakdown.novelty < 0.4);
    assert.ok(score.score < 0.6);
    assert.strictEqual(score.suggestion, false);
  });
});
