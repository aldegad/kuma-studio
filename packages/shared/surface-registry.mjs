// @ts-check

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_SURFACE_REGISTRY_PATH = "/tmp/kuma-surfaces.json";

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return String(value ?? "").trim();
}

/**
 * @param {string} name
 * @param {string} [emoji]
 * @returns {string}
 */
export function buildRegistryLabel(name, emoji = "") {
  const normalizedName = normalizeString(name);
  const normalizedEmoji = normalizeString(emoji);
  return normalizedEmoji && normalizedName ? `${normalizedEmoji} ${normalizedName}` : normalizedName;
}

/**
 * @param {string} label
 * @returns {{ name: string, emoji: string, text: string }}
 */
export function parseRegistryLabel(label) {
  const text = normalizeString(label);
  const emojiMatch = text.match(/^[\p{Extended_Pictographic}\uFE0F\s]+/u);
  const emojiPrefix = emojiMatch?.[0] ?? "";
  const name = text.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || text;
  const emoji = emojiPrefix.replace(/\s+/gu, "").trim();
  return { name, emoji, text };
}

/**
 * @param {Record<string, Record<string, string>> | unknown} registry
 * @returns {Record<string, Record<string, string>>}
 */
export function normalizeSurfaceRegistry(registry) {
  return Object.fromEntries(
    Object.entries(registry ?? {}).flatMap(([projectId, projectEntries]) => {
      if (!projectEntries || typeof projectEntries !== "object" || Array.isArray(projectEntries)) {
        return [];
      }

      const normalizedEntries = Object.fromEntries(
        Object.entries(projectEntries).flatMap(([label, surface]) => {
          const normalizedLabel = normalizeString(label);
          const normalizedSurface = normalizeString(surface);
          return normalizedLabel && normalizedSurface ? [[normalizedLabel, normalizedSurface]] : [];
        }),
      );

      return Object.keys(normalizedEntries).length > 0 ? [[projectId, normalizedEntries]] : [];
    }),
  );
}

/**
 * @param {string} [registryPath]
 * @returns {Record<string, Record<string, string>>}
 */
export function readSurfaceRegistryFile(registryPath = DEFAULT_SURFACE_REGISTRY_PATH) {
  try {
    return normalizeSurfaceRegistry(JSON.parse(readFileSync(registryPath, "utf8")));
  } catch {
    return {};
  }
}

/**
 * @param {string} registryPath
 * @param {Record<string, Record<string, string>>} registry
 * @returns {Record<string, Record<string, string>>}
 */
export function writeSurfaceRegistryFile(registryPath, registry) {
  const normalizedRegistry = normalizeSurfaceRegistry(registry);
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(normalizedRegistry, null, 2)}\n`, "utf8");
  return normalizedRegistry;
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {string} projectId
 * @param {string} label
 * @param {string} surface
 * @returns {Record<string, Record<string, string>>}
 */
export function upsertRegistryLabelSurface(registry, projectId, label, surface) {
  const normalizedProjectId = normalizeString(projectId);
  const normalizedLabel = normalizeString(label);
  const normalizedSurface = normalizeString(surface);
  const next = normalizeSurfaceRegistry(registry);

  if (!normalizedProjectId || !normalizedLabel || !normalizedSurface) {
    return next;
  }

  next[normalizedProjectId] = {
    ...(next[normalizedProjectId] ?? {}),
    [normalizedLabel]: normalizedSurface,
  };
  return normalizeSurfaceRegistry(next);
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {string} memberName
 * @param {string} [emoji]
 * @returns {Record<string, Record<string, string>>}
 */
export function removeRegistryMemberSurface(registry, memberName, emoji = "") {
  const normalizedName = normalizeString(memberName);
  const canonicalLabel = buildRegistryLabel(normalizedName, emoji);
  const next = normalizeSurfaceRegistry(registry);

  for (const [projectId, projectEntries] of Object.entries(next)) {
    for (const label of Object.keys(projectEntries)) {
      const parsed = parseRegistryLabel(label);
      if (
        label === normalizedName
        || label === canonicalLabel
        || parsed.name === normalizedName
      ) {
        delete projectEntries[label];
      }
    }

    if (Object.keys(projectEntries).length === 0) {
      delete next[projectId];
    }
  }

  return normalizeSurfaceRegistry(next);
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {Iterable<string>} surfacesToRemove
 * @param {string} [projectFilter]
 * @returns {Record<string, Record<string, string>>}
 */
export function removeSurfacesFromRegistry(registry, surfacesToRemove, projectFilter = "") {
  const removeSet = new Set(
    Array.from(surfacesToRemove ?? [])
      .map((surface) => normalizeString(surface))
      .filter(Boolean),
  );
  const normalizedProjectFilter = normalizeString(projectFilter);
  const next = normalizeSurfaceRegistry(registry);

  if (removeSet.size === 0) {
    return next;
  }

  for (const [projectId, projectEntries] of Object.entries(next)) {
    if (normalizedProjectFilter && projectId !== normalizedProjectFilter) {
      continue;
    }

    for (const [label, surface] of Object.entries(projectEntries)) {
      if (removeSet.has(surface)) {
        delete projectEntries[label];
      }
    }

    if (Object.keys(projectEntries).length === 0) {
      delete next[projectId];
    }
  }

  return normalizeSurfaceRegistry(next);
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {string} surface
 * @param {string} [projectFilter]
 * @returns {Record<string, Record<string, string>>}
 */
export function removeSurfaceFromRegistry(registry, surface, projectFilter = "") {
  return removeSurfacesFromRegistry(registry, [surface], projectFilter);
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {{ projectId: string, memberName: string, emoji?: string, surface: string }} input
 * @returns {Record<string, Record<string, string>>}
 */
export function updateRegistryMemberSurface(registry, { projectId, memberName, emoji = "", surface }) {
  const normalizedProjectId = normalizeString(projectId);
  const normalizedName = normalizeString(memberName);
  const normalizedSurface = normalizeString(surface);
  const next = removeRegistryMemberSurface(registry, normalizedName, emoji);

  if (!normalizedProjectId || !normalizedName || !normalizedSurface) {
    return next;
  }

  next[normalizedProjectId] = {
    ...(next[normalizedProjectId] ?? {}),
    [buildRegistryLabel(normalizedName, emoji)]: normalizedSurface,
  };
  return normalizeSurfaceRegistry(next);
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {string} projectId
 * @returns {string | null}
 */
export function resolveProjectAnchorSurface(registry, projectId) {
  const normalizedProjectId = normalizeString(projectId);
  const normalizedRegistry = normalizeSurfaceRegistry(registry);
  const projectEntries = normalizedRegistry[normalizedProjectId];
  if (!projectEntries || typeof projectEntries !== "object") {
    return null;
  }

  for (const surface of Object.values(projectEntries)) {
    if (typeof surface === "string" && surface.trim()) {
      return surface.trim();
    }
  }

  return null;
}

/**
 * @param {string} label
 * @param {{ displayName?: string, name?: string | { ko?: string }, emoji?: string, id?: string }} member
 * @returns {boolean}
 */
function labelMatchesMember(label, member) {
  const parsed = parseRegistryLabel(label);
  const displayName = normalizeString(member?.displayName ?? member?.name?.ko ?? member?.name);
  const memberEmoji = normalizeString(member?.emoji);
  const memberId = normalizeString(member?.id);
  const canonicalLabel = buildRegistryLabel(displayName, memberEmoji);

  return (
    (displayName && parsed.name === displayName)
    || (displayName && parsed.text === displayName)
    || (canonicalLabel && parsed.text === canonicalLabel)
    || (memberId && parsed.name === memberId)
    || (memberId && parsed.text === memberId)
    || (memberEmoji && parsed.emoji === memberEmoji)
  );
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {{ displayName?: string, name?: string | { ko?: string }, emoji?: string, id?: string, team?: string }} member
 * @param {string} [requestedProject]
 * @returns {{ project: string, label: string, surface: string } | null}
 */
export function resolveRegistryMemberContext(registry, member, requestedProject = "") {
  const normalizedRegistry = normalizeSurfaceRegistry(registry);
  const searchProjects = [
    normalizeString(requestedProject),
    normalizeString(member?.team),
    ...Object.keys(normalizedRegistry),
  ];
  const seenProjects = new Set();

  for (const projectId of searchProjects) {
    if (!projectId || seenProjects.has(projectId)) {
      continue;
    }
    seenProjects.add(projectId);

    const projectEntries = normalizedRegistry[projectId];
    if (!projectEntries || typeof projectEntries !== "object") {
      continue;
    }

    for (const [label, surface] of Object.entries(projectEntries)) {
      if (labelMatchesMember(label, member)) {
        return {
          project: projectId,
          label,
          surface: normalizeString(surface),
        };
      }
    }
  }

  return null;
}

/**
 * @param {string} registryPath
 * @returns {boolean}
 */
export function surfaceRegistryExists(registryPath = DEFAULT_SURFACE_REGISTRY_PATH) {
  return existsSync(registryPath);
}
