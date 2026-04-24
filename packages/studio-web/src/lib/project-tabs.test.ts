import { describe, expect, it } from "vitest";

import {
  buildStudioProjectTabs,
  CORE_PROJECT_TAB_ID,
  resolvePinnedHudProjectIds,
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
        makeProject("alpha-project"),
        makeProject("system"),
      ],
      ["beta-project", "gamma-project"],
    );

    expect(projectTabs.map((project) => project.projectId)).toEqual([
      CORE_PROJECT_TAB_ID,
      "beta-project",
      "gamma-project",
      "alpha-project",
    ]);
  });

  it("does not invent priority projects that are missing from live and configured data", () => {
    const projectTabs = buildStudioProjectTabs([], ["gamma-project"]);

    expect(projectTabs.map((project) => project.projectId)).toEqual([
      CORE_PROJECT_TAB_ID,
      "gamma-project",
    ]);
  });
});

describe("resolvePinnedHudProjectIds", () => {
  const projectTabs = buildStudioProjectTabs([], ["alpha-project", "beta-project"]);

  it("accepts non-core projects that exist in the selector", () => {
    expect(resolvePinnedHudProjectIds(projectTabs, ["alpha-project", "beta-project"])).toEqual([
      "alpha-project",
      "beta-project",
    ]);
  });

  it("rejects the core project, unknown ids, and duplicates", () => {
    expect(resolvePinnedHudProjectIds(projectTabs, [
      CORE_PROJECT_TAB_ID,
      "unknown-project",
      "alpha-project",
      "alpha-project",
    ])).toEqual(["alpha-project"]);
  });
});

describe("splitHudProjectTabs", () => {
  const projectTabs = buildStudioProjectTabs([], [
    "delta-project",
    "alpha-project",
    "beta-project",
  ]);

  it("shows kuma-studio plus every pinned project in the HUD", () => {
    const { visibleProjects, overflowProjects, pinnedProjectIds } = splitHudProjectTabs(projectTabs, [
      "alpha-project",
      "beta-project",
    ]);

    expect(pinnedProjectIds).toEqual(["alpha-project", "beta-project"]);
    expect(visibleProjects.map((project) => project.projectId)).toEqual([
      CORE_PROJECT_TAB_ID,
      "alpha-project",
      "beta-project",
    ]);
    expect(overflowProjects.map((project) => project.projectId)).toEqual([
      "delta-project",
    ]);
  });

  it("shows only kuma-studio on the HUD when nothing is pinned", () => {
    const { visibleProjects, overflowProjects, pinnedProjectIds } = splitHudProjectTabs(projectTabs, []);

    expect(pinnedProjectIds).toEqual([]);
    expect(visibleProjects.map((project) => project.projectId)).toEqual([
      CORE_PROJECT_TAB_ID,
    ]);
    expect(overflowProjects.map((project) => project.projectId)).toEqual([
      "delta-project",
      "alpha-project",
      "beta-project",
    ]);
  });
});
