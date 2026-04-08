import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, assert, describe, it } from "vitest";

import { TrendStore } from "./trend-store.mjs";

describe("trend-store", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("normalizes trend items and deduplicates by articleUrl", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-trend-store-"));
    tempDirs.push(root);

    const store = new TrendStore(root);
    const first = store.write({
      feedUrl: "https://example.com/feed.xml",
      articleUrl: "https://example.com/article-1",
      title: "첫 번째 트렌드",
      summary: "요약 1",
      publishedAt: "2026-04-08T00:00:00+09:00",
      tags: ["ai", "agents", "ai"],
      relevanceScore: "0.9",
    });

    const second = store.write({
      feedUrl: "https://example.com/feed.xml",
      articleUrl: "https://example.com/article-1",
      title: "업데이트된 트렌드",
      summary: "요약 2",
      publishedAt: "2026-04-08T01:00:00+09:00",
      tags: ["agents", "studio"],
      relevanceScore: 0.4,
    });

    assert.strictEqual(first.id, second.id);
    assert.strictEqual(second.title, "업데이트된 트렌드");
    assert.deepStrictEqual(second.tags, ["agents", "studio"]);
    assert.strictEqual(second.relevanceScore, 0.4);
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(store.readByArticleUrl("https://example.com/article-1")?.summary, "요약 2");
  });
});
