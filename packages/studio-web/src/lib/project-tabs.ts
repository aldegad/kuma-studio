export interface StudioProjectTab<Member = unknown> {
  projectId: string;
  projectName: string;
  members: Member[];
}

export const CORE_PROJECT_TAB_ID = "kuma-studio";
export const HUD_PROJECT_EXTRA_TAB_LIMIT = 1;

const RESERVED_PROJECT_IDS = new Set(["system", "workspace"]);
const PROJECT_TAB_PRIORITY = [
  CORE_PROJECT_TAB_ID,
  "my-agent-girlfriend",
  "pqc-unified",
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

  const orderedIds = [
    ...PROJECT_TAB_PRIORITY,
    ...configuredProjectIds,
    ...liveProjects.map((project) => project.projectId),
  ].filter((projectId, index, allIds) => isSelectableProjectId(projectId) && allIds.indexOf(projectId) === index);

  return orderedIds.map((projectId) =>
    projectById.get(projectId) ?? { projectId, projectName: projectId, members: [] },
  );
}

export function resolvePinnedHudProjectId<Member>(
  projectTabs: StudioProjectTab<Member>[],
  pinnedProjectId: string | null,
): string | null {
  if (!isSelectableProjectId(pinnedProjectId) || pinnedProjectId === CORE_PROJECT_TAB_ID) {
    return null;
  }

  return projectTabs.some((project) => project.projectId === pinnedProjectId)
    ? pinnedProjectId
    : null;
}

export function splitHudProjectTabs<Member>(
  projectTabs: StudioProjectTab<Member>[],
  pinnedProjectId: string | null,
  extraLimit = HUD_PROJECT_EXTRA_TAB_LIMIT,
) {
  const resolvedPinnedProjectId = resolvePinnedHudProjectId(projectTabs, pinnedProjectId);
  const coreProject = projectTabs.find((project) => project.projectId === CORE_PROJECT_TAB_ID) ?? null;
  const extraProjectIds: string[] = [];

  if (resolvedPinnedProjectId) {
    extraProjectIds.push(resolvedPinnedProjectId);
  }

  const visibleProjectIds = new Set([
    ...(coreProject ? [coreProject.projectId] : []),
    ...extraProjectIds.slice(0, extraLimit),
  ]);

  return {
    pinnedProjectId: resolvedPinnedProjectId,
    visibleProjects: projectTabs.filter((project) => visibleProjectIds.has(project.projectId)),
    overflowProjects: projectTabs.filter((project) => !visibleProjectIds.has(project.projectId)),
  };
}
