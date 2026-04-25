export interface StudioProjectTab<Member = unknown> {
  projectId: string;
  projectName: string;
  members: Member[];
}

export const CORE_PROJECT_TAB_ID = "kuma-studio";
export const SYSTEM_PROJECT_TAB_ID = "system";

const RESERVED_PROJECT_IDS = new Set(["workspace"]);
const PROJECT_TAB_PRIORITY = [
  SYSTEM_PROJECT_TAB_ID,
  CORE_PROJECT_TAB_ID,
];

function isSelectableProjectId(projectId: string | null | undefined): projectId is string {
  return typeof projectId === "string" && projectId.trim().length > 0 && !RESERVED_PROJECT_IDS.has(projectId);
}

export function buildStudioProjectTabs<Member>(
  liveProjects: StudioProjectTab<Member>[],
  configuredProjectIds: string[],
): StudioProjectTab<Member>[] {
  const projectById = new Map<string, StudioProjectTab<Member>>();
  for (const project of liveProjects) {
    if (!isSelectableProjectId(project.projectId)) {
      continue;
    }
    projectById.set(project.projectId, project);
  }

  const discoveredProjectIds = [
    ...configuredProjectIds,
    ...liveProjects.map((project) => project.projectId),
  ].filter((projectId, index, allIds) => isSelectableProjectId(projectId) && allIds.indexOf(projectId) === index);
  const orderedIds = [
    ...PROJECT_TAB_PRIORITY.filter(
      (projectId) => projectId === CORE_PROJECT_TAB_ID || discoveredProjectIds.includes(projectId),
    ),
    ...discoveredProjectIds.filter((projectId) => !PROJECT_TAB_PRIORITY.includes(projectId)),
  ].filter((projectId, index, allIds) => allIds.indexOf(projectId) === index);

  return orderedIds.map((projectId) =>
    projectById.get(projectId) ?? { projectId, projectName: projectId, members: [] },
  );
}

export function resolvePinnedHudProjectIds<Member>(
  projectTabs: StudioProjectTab<Member>[],
  pinnedProjectIds: string[],
): string[] {
  const projectIds = new Set(projectTabs.map((project) => project.projectId));
  const resolved: string[] = [];

  for (const projectId of pinnedProjectIds) {
    if (
      !isSelectableProjectId(projectId) ||
      projectId === CORE_PROJECT_TAB_ID ||
      projectId === SYSTEM_PROJECT_TAB_ID ||
      !projectIds.has(projectId) ||
      resolved.includes(projectId)
    ) {
      continue;
    }
    resolved.push(projectId);
  }

  return resolved;
}

export function splitHudProjectTabs<Member>(
  projectTabs: StudioProjectTab<Member>[],
  pinnedProjectIds: string[],
) {
  const resolvedPinnedProjectIds = resolvePinnedHudProjectIds(projectTabs, pinnedProjectIds);
  const coreProject = projectTabs.find((project) => project.projectId === CORE_PROJECT_TAB_ID) ?? null;
  const systemProject = projectTabs.find((project) => project.projectId === SYSTEM_PROJECT_TAB_ID) ?? null;

  const visibleProjectIds = new Set([
    ...(systemProject ? [systemProject.projectId] : []),
    ...(coreProject ? [coreProject.projectId] : []),
    ...resolvedPinnedProjectIds,
  ]);

  return {
    pinnedProjectIds: resolvedPinnedProjectIds,
    visibleProjects: projectTabs.filter((project) => visibleProjectIds.has(project.projectId)),
    overflowProjects: projectTabs.filter((project) => !visibleProjectIds.has(project.projectId)),
  };
}
