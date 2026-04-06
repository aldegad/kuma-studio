import { assert, describe, it } from "vitest";

import { classifySurfaceStatus } from "../packages/server/src/studio/team-status-store.mjs";

describe("status-classify-fix", () => {
  it("treats prompt and cli chrome lines as idle", () => {
    const cases = [
      "❯",
      "› Summarize recent commits",
      "─────────────────────────────  ⏵⏵ bypass permissions on",
      "───────────────────────────────",
      "  ⏵⏵ bypass permissions on (shift+tab",
      "✻ Brewed for 2m 30s",
      "gpt-5.4 high fast · 69% left",
    ];

    for (const value of cases) {
      assert.strictEqual(classifySurfaceStatus(value), "idle", value);
    }
  });

  it("treats actual active output as working", () => {
    assert.strictEqual(classifySurfaceStatus("• Running npm test"), "working");
  });
});
