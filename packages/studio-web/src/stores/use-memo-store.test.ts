import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Memo } from "../types/memo";

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: { hostname: "localhost" } },
    configurable: true,
    writable: true,
  });
});

describe("useMemoStore helpers", () => {
  it("sorts memos by newest createdAt first", async () => {
    vi.resetModules();
    const { sortMemosNewestFirst } = await import("./use-memo-store");
    const memos: Memo[] = [
      { id: "older", title: "older", images: [], createdAt: "2026-04-03T01:50:00.000Z" },
      { id: "newer", title: "newer", images: [], createdAt: "2026-04-06T09:00:00.000Z" },
      { id: "middle", title: "middle", images: [], createdAt: "2026-04-04T12:00:00.000Z" },
    ];

    expect(sortMemosNewestFirst(memos).map((memo) => memo.id)).toEqual([
      "newer",
      "middle",
      "older",
    ]);
  });
});
