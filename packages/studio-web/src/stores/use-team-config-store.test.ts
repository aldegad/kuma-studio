import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: { hostname: "localhost" } },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function loadStoreWithPayload(payload: unknown) {
  vi.doMock("../lib/api", () => ({
    fetchTeamConfig: vi.fn().mockResolvedValue(payload),
  }));

  return import("./use-team-config-store");
}

describe("useTeamConfigStore", () => {
  it("keeps model catalog entries and per-member modelCatalogId values from the API", async () => {
    const payload = {
      members: {
        "밤토리": {
          id: "bamdori",
          emoji: "🦔",
          role: "QA",
          team: "dev",
          nodeType: "worker",
          type: "codex",
          model: "gpt-5.4-mini",
          modelCatalogId: "gpt-5.4-mini-xhigh-fast",
          options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
          nameEn: "Bamdori",
          animalKo: "고슴도치",
          animalEn: "hedgehog",
          image: "",
          skills: [],
          parentId: null,
        },
      },
      defaults: {
        claude: {
          model: "claude-opus-4-6",
          modelCatalogId: "claude-opus-4-6-high",
          options: "--dangerously-skip-permissions",
        },
        codex: {
          model: "gpt-5.4",
          modelCatalogId: "gpt-5.4-xhigh-fast",
          options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
        },
      },
      modelCatalog: [
        {
          id: "gpt-5.4-mini-xhigh-fast",
          type: "codex",
          model: "gpt-5.4-mini",
          label: "GPT-5.4 mini · xhigh · fast",
          effort: "xhigh",
          serviceTier: "fast",
        },
      ],
    };

    const { useTeamConfigStore } = await loadStoreWithPayload(payload);
    const agents = await useTeamConfigStore.getState().fetch();

    expect(useTeamConfigStore.getState().modelCatalog).toEqual(payload.modelCatalog);
    expect(agents.find((agent) => agent.id === "bamdori")?.modelCatalogId).toBe("gpt-5.4-mini-xhigh-fast");
  });
});
