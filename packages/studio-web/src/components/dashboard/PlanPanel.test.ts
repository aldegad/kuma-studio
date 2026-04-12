import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, PlanStatus } from "../../types/plan";

function planWithStatus(id: string, status: PlanStatus): Plan {
  return {
    id,
    project: null,
    title: id,
    status,
    statusColor: "gray",
    created: null,
    body: "",
    sections: [],
    totalItems: 0,
    checkedItems: 0,
    completionRate: 0,
    warnings: [],
  };
}

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    get length() { return store.size; },
  };
}

describe("getPlanPanelEmptyState", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "window", {
      value: { location: { hostname: "localhost" } },
      configurable: true,
      writable: true,
    });
  });

  it("describes an unbound workspace as a misconfiguration", async () => {
    const { getPlanPanelEmptyState } = await import("./PlanPanel");
    expect(getPlanPanelEmptyState({
      status: "misconfigured",
    })).toEqual({
      title: "계획 문서 경로 미설정",
      detail: "워크스페이스 바인딩 없이 서버가 시작되어 계획 문서를 찾을 수 없습니다.",
    });
  });

  it("shows the missing plans directory when the workspace is bound but empty on disk", async () => {
    const { getPlanPanelEmptyState } = await import("./PlanPanel");
    expect(getPlanPanelEmptyState({
      status: "missing_dir",
      plansDir: "/tmp/workspace/.kuma/plans",
    })).toEqual({
      title: "계획 폴더를 찾지 못했습니다",
      detail: "/tmp/workspace/.kuma/plans",
    });
  });

  it("keeps the plain empty-state copy for a genuinely empty plans source", async () => {
    const { getPlanPanelEmptyState } = await import("./PlanPanel");
    expect(getPlanPanelEmptyState({
      status: "ready",
      plansDir: "/tmp/workspace/.kuma/plans",
    })).toEqual({
      title: "계획문서 없음",
      detail: null,
    });
  });
});

describe("plan status filter helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: createMemoryStorage(), location: { hostname: "localhost" } },
      configurable: true,
      writable: true,
    });
  });

  it("returns the original list when no statuses are hidden", async () => {
    const { filterPlansByStatus } = await import("./PlanPanel");
    const plans = [planWithStatus("a", "completed"), planWithStatus("b", "active")];
    const filtered = filterPlansByStatus(plans, new Set());
    expect(filtered).toHaveLength(2);
    expect(filtered).toBe(plans);
  });

  it("hides plans whose status is in the hidden set", async () => {
    const { filterPlansByStatus } = await import("./PlanPanel");
    const plans = [
      planWithStatus("a", "completed"),
      planWithStatus("b", "active"),
      planWithStatus("c", "hold"),
    ];
    const filtered = filterPlansByStatus(plans, new Set(["active"]));
    expect(filtered.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("treats cancelled as completed for filter purposes", async () => {
    const { filterPlansByStatus, canonicalFilterStatus } = await import("./PlanPanel");
    expect(canonicalFilterStatus("cancelled")).toBe("completed");
    const plans = [
      planWithStatus("done", "completed"),
      planWithStatus("cx", "cancelled"),
      planWithStatus("run", "active"),
    ];
    const filtered = filterPlansByStatus(plans, new Set(["completed"]));
    expect(filtered.map((p) => p.id)).toEqual(["run"]);
  });

  it("collects distinct visible statuses in first-seen order, collapsing cancelled with completed", async () => {
    const { collectVisibleFilterStatuses } = await import("./PlanPanel");
    const statuses = collectVisibleFilterStatuses([
      planWithStatus("a", "active"),
      planWithStatus("b", "cancelled"),
      planWithStatus("c", "completed"),
      planWithStatus("d", "active"),
      planWithStatus("e", "hold"),
    ]);
    expect(statuses).toEqual(["active", "completed", "hold"]);
  });

  it("restores hidden statuses from localStorage across module reloads", async () => {
    const first = await import("./PlanPanel");
    expect(first.loadHiddenStatuses().size).toBe(0);

    window.localStorage.setItem(
      "kuma-studio.plan-panel.hidden-statuses.v1",
      JSON.stringify(["completed", "hold"]),
    );

    vi.resetModules();
    const reloaded = await import("./PlanPanel");
    const restored = reloaded.loadHiddenStatuses();
    expect(restored.has("completed")).toBe(true);
    expect(restored.has("hold")).toBe(true);
    expect(restored.size).toBe(2);
  });

  it("returns an empty set when stored payload is malformed", async () => {
    window.localStorage.setItem(
      "kuma-studio.plan-panel.hidden-statuses.v1",
      "{not-json",
    );
    const { loadHiddenStatuses } = await import("./PlanPanel");
    expect(loadHiddenStatuses().size).toBe(0);
  });
});
