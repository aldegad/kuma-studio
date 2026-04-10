// @ts-check

import rawTeamSchema from "./team.json" with { type: "json" };

/** @typedef {"claude" | "codex"} ModelType */

const VALID_MODEL_TYPES = new Set(["claude", "codex"]);
const VALID_REASONING_LEVELS = new Set(["low", "medium", "high", "xhigh"]);
const VALID_SERVICE_TIERS = new Set(["default", "fast"]);

/**
 * @typedef {{
 *   id: string,
 *   type: ModelType,
 *   model: string,
 *   label: string,
 *   effort?: "low" | "medium" | "high" | "xhigh",
 *   serviceTier?: "default" | "fast",
 *   options?: string,
 * }} ModelCatalogEntry
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return String(value ?? "").trim();
}

/**
 * @param {unknown} rawEntry
 * @returns {ModelCatalogEntry | null}
 */
export function normalizeModelCatalogEntry(rawEntry) {
  const id = normalizeString(rawEntry?.id);
  const type = normalizeString(rawEntry?.type);
  const model = normalizeString(rawEntry?.model);
  const label = normalizeString(rawEntry?.label);
  const effort = normalizeString(rawEntry?.effort).toLowerCase();
  const serviceTier = normalizeString(rawEntry?.serviceTier).toLowerCase();
  const options = normalizeString(rawEntry?.options);

  if (!id || !VALID_MODEL_TYPES.has(type) || !model || !label) {
    return null;
  }

  return {
    id,
    type,
    model,
    label,
    ...(VALID_REASONING_LEVELS.has(effort) ? { effort } : {}),
    ...(VALID_SERVICE_TIERS.has(serviceTier) ? { serviceTier } : {}),
    ...(options ? { options } : {}),
  };
}

/**
 * @param {unknown} rawCatalog
 * @returns {ModelCatalogEntry[]}
 */
export function normalizeModelCatalog(rawCatalog) {
  const seenIds = new Set();
  const normalized = [];

  for (const rawEntry of Array.isArray(rawCatalog) ? rawCatalog : []) {
    const entry = normalizeModelCatalogEntry(rawEntry);
    if (!entry || seenIds.has(entry.id)) {
      continue;
    }

    seenIds.add(entry.id);
    normalized.push(entry);
  }

  return normalized;
}

/** @type {readonly ModelCatalogEntry[]} */
export const MODEL_CATALOG = Object.freeze(normalizeModelCatalog(rawTeamSchema?.modelCatalog));

/**
 * @param {readonly ModelCatalogEntry[] | unknown} [catalog]
 * @returns {readonly ModelCatalogEntry[]}
 */
function getCatalogEntries(catalog = MODEL_CATALOG) {
  const normalized = normalizeModelCatalog(catalog);
  return normalized.length > 0 ? normalized : MODEL_CATALOG;
}

/**
 * @param {string} id
 * @param {readonly ModelCatalogEntry[] | unknown} [catalog]
 * @returns {ModelCatalogEntry | undefined}
 */
export function getModelCatalogEntry(id, catalog = MODEL_CATALOG) {
  const normalizedId = normalizeString(id);
  return getCatalogEntries(catalog).find((entry) => entry.id === normalizedId);
}

/**
 * @param {ModelType} type
 * @param {readonly ModelCatalogEntry[] | unknown} [catalog]
 * @returns {readonly ModelCatalogEntry[]}
 */
export function listModelCatalogByType(type, catalog = MODEL_CATALOG) {
  return getCatalogEntries(catalog).filter((entry) => entry.type === type);
}
