export const GLOBAL_DECISION_SCOPE = "global";
export const PROJECT_DECISION_SCOPE_PREFIX = "project:";
export const PROJECT_DECISION_FILE_SUFFIX = ".project-decisions.md";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeProjectDecisionName(value) {
  return trimString(value)
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function formatProjectDecisionScope(projectName) {
  const normalized = normalizeProjectDecisionName(projectName);
  return normalized ? `${PROJECT_DECISION_SCOPE_PREFIX}${normalized}` : "";
}

export function parseDecisionScope(scope) {
  const normalizedScope = trimString(scope);
  if (!normalizedScope || normalizedScope === GLOBAL_DECISION_SCOPE) {
    return { kind: "global", scope: GLOBAL_DECISION_SCOPE, projectName: "" };
  }

  if (normalizedScope.startsWith(PROJECT_DECISION_SCOPE_PREFIX)) {
    const projectName = normalizeProjectDecisionName(normalizedScope.slice(PROJECT_DECISION_SCOPE_PREFIX.length));
    if (projectName) {
      return {
        kind: "project",
        scope: formatProjectDecisionScope(projectName),
        projectName,
      };
    }
  }

  return {
    kind: "other",
    scope: normalizedScope,
    projectName: "",
  };
}

export function isProjectDecisionScope(scope) {
  return parseDecisionScope(scope).kind === "project";
}

export function projectDecisionFileName(projectName) {
  const normalized = normalizeProjectDecisionName(projectName);
  if (!normalized) {
    throw new Error("project decision file name requires a project name");
  }
  return `${normalized}${PROJECT_DECISION_FILE_SUFFIX}`;
}
