import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: { hostname: "localhost" } },
    configurable: true,
    writable: true,
  });
});

describe("memo api payload validation", () => {
  it("accepts memo list payloads with canonical vault memo source", async () => {
    vi.resetModules();
    const payload = {
      memos: [
        {
          id: "memo.md",
          path: "memo.md",
          title: "User Memo",
          text: "hello",
          images: [],
          createdAt: "2026-04-10T00:00:00.000Z",
          source: "vault",
          section: "memos",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }));

    const { fetchMemos } = await import("./api");

    await expect(fetchMemos()).resolves.toEqual(payload);
  });

  it("accepts created memo payloads with canonical vault memo source", async () => {
    vi.resetModules();
    const payload = {
      id: "memo.md",
      path: "memo.md",
      title: "User Memo",
      text: "hello",
      images: [],
      createdAt: "2026-04-10T00:00:00.000Z",
      source: "vault",
      section: "memos",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }));

    const { createMemo } = await import("./api");

    await expect(createMemo({
      title: "User Memo",
      text: "hello",
      images: [],
    })).resolves.toEqual(payload);
  });
});

describe("team status api payload validation", () => {
  it("preserves offline members from team-status payloads", async () => {
    vi.resetModules();
    const payload = {
      projects: [
        {
          projectId: "kuma-studio",
          projectName: "kuma-studio",
          members: [
            {
              id: "tookdaki",
              surface: "surface:18",
              state: "offline",
              lastOutputLines: [],
              task: null,
              modelInfo: null,
              updatedAt: "2026-04-10T00:00:00.000Z",
            },
          ],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }));

    const { fetchTeamStatus } = await import("./api");

    await expect(fetchTeamStatus()).resolves.toEqual(payload);
  });
});
