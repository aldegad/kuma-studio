import { describe, expect, it } from "vitest";

import {
  buildStudioProjectTabs,
  CORE_PROJECT_TAB_ID,
  resolvePinnedHudProjectId,
  splitHudProjectTabs,
  type StudioProjectTab,
} from "./project-tabs";

function makeProject(projectId: string): StudioProjectTab<string> {
  return {
    projectId,
    projectName: projectId,
    members: [],
  };
}

describe("buildStudioProjectTabs", () => {
  it("keeps kuma-studio first, includes configured projects, and filters reserved ids", () => {
    const projectTabs = buildStudioProjectTabs(
      [
        makeProject("workspace"),
        makeProject("my-agent-girlfriend"),
        makeProject("system"),
      ],
      ["pqc-unified", "life-ai"],
    );

    expect(projectTabs.map((project) => project.projectId)).toEqual([
      CORE_PROJECT_TAB_ID,
      "my-agent-girlfriend",
      "pqc-unified",
      "life-ai",
    ]);
  });
});

describe("resolvePinnedHudProjectId", () => {
  const projectTabs = buildStudioProjectTabs([], ["pqc-unified", "life-ai"]);

  it("accepts a non-core project that exists in the selector", () => {
    expect(resolvePinnedHudProjectId(projectTabs, "pqc-unified")).toBe("pqc-unified");
  });

  it("rejects the core project and unknown ids", () => {
    expect(resolvePinnedHudProjectId(projectTabs, CORE_PROJECT_TAB_ID)).toBeNull();
    expect(resolvePinnedHudProjectId(projectTabs, "unknown-project")).toBeNull();
  });
});

describe("splitHudProjectTabs", () => {
  const projectTabs = buildStudioProjectTabs([], [
    "my-agent-girlfriend",
    "pqc-unified",
    "life-ai",
  ]);

  it("shows kuma-studio plus the pinned project in the HUD", () => {
    const { visibleProjects, overflowProjects, pinnedProjectId } = splitHudProjectTabs(projectTabs, "pqc-unified");

    expect(pinnedProjectId).toBe("pqc-unified");
    expect(visibleProjects.map((project) => project.projectId)).toEqual([
      CORE_PROJECT_TAB_ID,
      "pqc-unified",
    ]);
    expect(overflowProjects.map((project) => project.projectId)).toEqual([
      "my-agent-girlfriend",
      "life-ai",
    ]);
  });

  it("falls back to the first non-core project when nothing is pinned", () => {
    const { visibleProjects, overflowProjects, pinnedProjectId } = splitHudProjectTabs(projectTabs, null);

    expect(pinnedProjectId).toBeNull();
    expect(visibleProjects.map((project) => project.projectId)).toEqual([
      CORE_PROJECT_TAB_ID,
      "my-agent-girlfriend",
    ]);
    expect(overflowProjects.map((project) => project.projectId)).toEqual([
      "pqc-unified",
      "life-ai",
    ]);
  });
});
