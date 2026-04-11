import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export const DEFAULT_PROJECTS_PATH = resolve(join(homedir(), ".kuma", "projects.json"));

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveMaybeRealPath(targetPath) {
  const normalized = resolve(targetPath);
  try {
    return realpathSync(normalized);
  } catch {
    return normalized;
  }
}

export function normalizePackageNameToProjectId(name) {
  const normalized = normalizeOptionalString(name);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("@") && normalized.includes("/")) {
    return normalizeOptionalString(normalized.split("/").slice(-1)[0]);
  }

  return normalized;
}

export function readProjectsRegistry(projectsPath = DEFAULT_PROJECTS_PATH) {
  if (!existsSync(projectsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(projectsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([projectId, projectPath]) => {
          const normalizedId = normalizeOptionalString(projectId);
          const normalizedPath = normalizeOptionalString(projectPath);
          if (!normalizedId || !normalizedPath) {
            return null;
          }

          return [normalizedId, resolveMaybeRealPath(normalizedPath)];
        })
        .filter((entry) => Array.isArray(entry)),
    );
  } catch {
    return {};
  }
}

export function resolveProjectIdFromDirectory(directory, projectsPath = DEFAULT_PROJECTS_PATH) {
  const normalizedDir = normalizeOptionalString(directory);
  if (!normalizedDir) {
    return null;
  }

  const resolvedDir = resolveMaybeRealPath(normalizedDir);
  const registry = readProjectsRegistry(projectsPath);
  let bestMatch = null;

  for (const [projectId, projectPath] of Object.entries(registry)) {
    if (resolvedDir === projectPath || resolvedDir.startsWith(`${projectPath}${sep}`)) {
      if (!bestMatch || projectPath.length > bestMatch.path.length) {
        bestMatch = { id: projectId, path: projectPath };
      }
    }
  }

  return bestMatch?.id ?? null;
}

export function readPackageProjectId(directory) {
  const normalizedDir = normalizeOptionalString(directory);
  if (!normalizedDir) {
    return null;
  }

  const packageJsonPath = join(resolveMaybeRealPath(normalizedDir), "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return normalizePackageNameToProjectId(parsed?.name);
  } catch {
    return null;
  }
}

export function getConfiguredDefaultProjectId(options = {}) {
  const {
    workspaceRoot = process.env.KUMA_STUDIO_WORKSPACE,
    cwd = process.cwd(),
    projectsPath = DEFAULT_PROJECTS_PATH,
    fallback = null,
  } = options;

  const explicit =
    normalizeOptionalString(process.env.KUMA_DEFAULT_PROJECT)
    ?? normalizeOptionalString(process.env.KUMA_STUDIO_DEFAULT_PROJECT);
  if (explicit) {
    return explicit;
  }

  const candidates = [...new Set([workspaceRoot, cwd].map((entry) => normalizeOptionalString(entry)).filter(Boolean))];
  for (const candidate of candidates) {
    const projectId = resolveProjectIdFromDirectory(candidate, projectsPath);
    if (projectId) {
      return projectId;
    }
  }

  for (const candidate of candidates) {
    const projectId = readPackageProjectId(candidate);
    if (projectId) {
      return projectId;
    }
  }

  const registryIds = Object.keys(readProjectsRegistry(projectsPath));
  if (registryIds.length === 1) {
    return registryIds[0];
  }

  return fallback;
}

export function getDefaultProjectIdForTeam(teamId, options = {}) {
  if (teamId === "system") {
    return "system";
  }

  return getConfiguredDefaultProjectId(options) ?? "workspace";
}

export function inferProjectIdFromSlugPrefix(sourceSlug, options = {}) {
  const normalizedSlug = normalizeOptionalString(sourceSlug);
  if (!normalizedSlug) {
    return null;
  }

  const registryIds = Object.keys(readProjectsRegistry(options.projectsPath));
  const packageIds = [
    readPackageProjectId(options.workspaceRoot ?? process.env.KUMA_STUDIO_WORKSPACE),
    readPackageProjectId(options.cwd ?? process.cwd()),
  ].filter(Boolean);
  const defaultIds = [
    getConfiguredDefaultProjectId({ ...options, fallback: null }),
  ].filter(Boolean);

  const candidates = [...new Set([...registryIds, ...packageIds, ...defaultIds])]
    .sort((left, right) => right.length - left.length);

  return candidates.find((projectId) => normalizedSlug.startsWith(`${projectId}-`)) ?? null;
}
