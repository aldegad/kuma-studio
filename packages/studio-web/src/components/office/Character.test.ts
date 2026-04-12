import { beforeEach, describe, expect, it, vi } from "vitest";

describe("getVisibleSpeechBubbleLines", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "window", {
      value: { location: { hostname: "localhost" } },
      configurable: true,
      writable: true,
    });
  });

  it("returns the most recent two meaningful lines", async () => {
    const { getVisibleSpeechBubbleLines } = await import("./Character");
    expect(
      getVisibleSpeechBubbleLines([
        "Starting build",
        "",
        "Applying patch",
        "  ",
        "Verifying result",
      ]),
    ).toEqual(["Applying patch", "Verifying result"]);
  });

  it("keeps shorter speech output intact", async () => {
    const { getVisibleSpeechBubbleLines } = await import("./Character");
    expect(getVisibleSpeechBubbleLines(["Reviewing mobile playback"])).toEqual(["Reviewing mobile playback"]);
  });
});
