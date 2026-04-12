import { beforeEach, describe, expect, it, vi } from "vitest";

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
