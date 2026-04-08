import { assert, describe, it } from "vitest";

import { formatThreadPostsForClipboard, generateThreadPosts } from "./content-post-generator.mjs";

describe("content-post-generator", () => {
  it("creates deterministic thread posts with source attribution and tag-aware CTA", () => {
    const posts = generateThreadPosts({
      title: "AI agents are moving from demos to orchestration stacks",
      summary:
        "Teams are shipping longer workflows instead of isolated prompts. The real bottleneck is latency across tools. Operators now care more about orchestration than raw model wins.",
      sourceLinks: ["https://example.com/agents", "https://news.example.com/analysis"],
      tags: ["agents", "infra"],
    });

    assert.ok(posts.length >= 1);
    assert.ok(posts.every((post) => post.hook.length > 0));
    assert.ok(posts.every((post) => post.bodyLines.length >= 1 && post.bodyLines.length <= 3));
    assert.ok(posts[posts.length - 1].cta.includes("orchestration"));
    assert.ok(posts.flatMap((post) => post.bodyLines).some((line) => line.includes("출처:")));
  });

  it("formats generated posts for clipboard copy", () => {
    const text = formatThreadPostsForClipboard([
      {
        hook: "Hook",
        bodyLines: ["Line 1", "Line 2"],
        cta: "CTA",
        format: "single",
      },
    ]);

    assert.strictEqual(text, "Hook\nLine 1\nLine 2\nCTA");
  });
});
