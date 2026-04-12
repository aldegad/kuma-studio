import { describe, expect, it } from "vitest";

import {
  classifySurfaceOutput,
  classifySurfaceStatus,
  isAmbiguousWorkingSurfaceOutput,
} from "../surface-classifier.mjs";

describe("shared surface classifier", () => {
  it("treats bypass permissions banners as idle footer noise", () => {
    const output = [
      "───────────────────────────",
      "❯",
      "───────────────────────────",
      "  ⏵⏵ bypass permissions",
      "  Now using extra usage",
    ].join("\n");

    expect(classifySurfaceStatus(output)).toBe("idle");
    expect(classifySurfaceOutput(output)).toEqual({
      status: "idle",
      preview: "",
      lastOutputLines: [],
    });
  });

  it("treats compact/statusline/footer hints as idle", () => {
    const output = [
      "Compacting conversation...",
      "⎿ Tip: Use /statusline off to disable the status line",
      "shift+tab to cycle",
      "tab to queue",
      "❯",
    ].join("\n");

    expect(classifySurfaceStatus(output)).toBe("idle");
    expect(classifySurfaceOutput(output).preview).toBe("");
  });

  it("treats a Claude prompt-only surface as idle", () => {
    expect(classifySurfaceStatus("claude-opus-4-6\nesc to interrupt\ntab to queue\n❯")).toBe("idle");
  });

  it("keeps active work as working and returns the last meaningful preview", () => {
    const output = [
      "• Working (34s • esc to interr…)",
      "Reading packages/server/src/index.mjs",
      "gpt-5.4 high fast · 46% left",
    ].join("\n");

    expect(classifySurfaceStatus(output)).toBe("working");
    expect(classifySurfaceOutput(output)).toEqual({
      status: "working",
      preview: "Reading packages/server/src/index.mjs",
      lastOutputLines: [
        "• Working (34s • esc to interr…)",
        "Reading packages/server/src/index.mjs",
      ],
    });
  });

  it("flags plain-text output without a live work signal as ambiguous", () => {
    expect(isAmbiguousWorkingSurfaceOutput("Reviewing dashboard sync")).toBe(true);
    expect(isAmbiguousWorkingSurfaceOutput("• Working (34s • esc to interr…)")).toBe(false);
    expect(isAmbiguousWorkingSurfaceOutput("Reviewing dashboard sync\n❯")).toBe(false);
  });
});
