const GLOBAL_SCOPE_HINT_PATTERNS = [
  /(?:시스템\s*프롬프트|startup\/system prompt|system prompt|startup prompt)/iu,
  /(?:내\s*(?:스타일|말투|톤|보고)|나의?\s*(?:스타일|말투|톤|보고))/iu,
  /(?:말투|톤|voice|tone|보고(?:\s*체계|\s*방식|\s*형식)?)/iu,
  /(?:아키텍처\s*스타일|architecture style|전역\s*원칙|공용\s*원칙)/iu,
  /\b(?:ssot|srp)\b/iu,
  /(?:single source of truth|no-legacy-fallback|legacy fallback|fallback)/iu,
  /(?:정합성|원자성|멱등성|consistency|atomicity|idempotency)/iu,
];

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

export function resolveDecisionCaptureScope({ text, projectName = "", defaultScope = GLOBAL_DECISION_SCOPE } = {}) {
  const normalizedText = trimString(text);
  if (normalizedText && GLOBAL_SCOPE_HINT_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return GLOBAL_DECISION_SCOPE;
  }

  const projectScope = formatProjectDecisionScope(projectName);
  if (projectScope) {
    return projectScope;
  }

  const parsedDefaultScope = parseDecisionScope(defaultScope);
  return parsedDefaultScope.scope || GLOBAL_DECISION_SCOPE;
}
