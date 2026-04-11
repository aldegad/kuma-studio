import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadStoreModule() {
  vi.resetModules();
  return import("./use-dispatch-visual-store");
}

describe("useDispatchVisualStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("formats compact dispatch bubble lines with prefixes", async () => {
    const { formatDispatchBubbleLines } = await loadStoreModule();
    expect(formatDispatchBubbleLines("Need API confirmation.", "question")).toEqual(["? Need API confirmation."]);
    expect(formatDispatchBubbleLines("Use the existing route handler.", "answer")).toEqual([
      "↩ Use the existing route",
      "handler.…",
    ]);
  });

  it("shows a bubble briefly and clears it after the duration", async () => {
    const { useDispatchVisualStore } = await loadStoreModule();

    useDispatchVisualStore.getState().showBubble("koon", "Need API confirmation.", "question", 1_000);
    expect(useDispatchVisualStore.getState().bubbles.koon).toEqual(["? Need API confirmation."]);

    vi.advanceTimersByTime(1_000);
    expect(useDispatchVisualStore.getState().bubbles.koon).toBeUndefined();
  });
});
