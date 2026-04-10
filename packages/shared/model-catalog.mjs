// @ts-check

/**
 * Single source of truth for the set of selectable LLM models across
 * kuma-studio server (team-config-store) and studio-web UI (SettingsPanel).
 */

/** @typedef {"claude" | "codex"} ModelType */

/**
 * @typedef {{
 *   id: string,
 *   type: ModelType,
 *   model: string,
 *   label: string,
 *   effort?: "low" | "medium" | "high" | "xhigh",
 *   serviceTier?: "default" | "fast",
 * }} ModelCatalogEntry
 */

/** @type {readonly ModelCatalogEntry[]} */
export const MODEL_CATALOG = Object.freeze([
  {
    id: "claude-opus-4-6-high",
    type: "claude",
    model: "claude-opus-4-6",
    label: "Claude Opus 4.6 · high",
  },
  {
    id: "claude-sonnet-4-6-high",
    type: "claude",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 · high",
  },
  {
    id: "gpt-5.4-high-fast",
    type: "codex",
    model: "gpt-5.4",
    label: "GPT-5.4 · high · fast",
    effort: "high",
    serviceTier: "fast",
  },
  {
    id: "gpt-5.4-xhigh-fast",
    type: "codex",
    model: "gpt-5.4",
    label: "GPT-5.4 · xhigh · fast",
    effort: "xhigh",
    serviceTier: "fast",
  },
  {
    id: "gpt-5.4-mini-high-fast",
    type: "codex",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini · high · fast",
    effort: "high",
    serviceTier: "fast",
  },
  {
    id: "gpt-5.4-mini-xhigh-fast",
    type: "codex",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini · xhigh · fast",
    effort: "xhigh",
    serviceTier: "fast",
  },
]);

const MODEL_CATALOG_BY_ID = new Map(MODEL_CATALOG.map((entry) => [entry.id, entry]));

/**
 * @param {string} id
 * @returns {ModelCatalogEntry | undefined}
 */
export function getModelCatalogEntry(id) {
  return MODEL_CATALOG_BY_ID.get(String(id ?? ""));
}

/**
 * @param {ModelType} type
 * @returns {readonly ModelCatalogEntry[]}
 */
export function listModelCatalogByType(type) {
  return MODEL_CATALOG.filter((entry) => entry.type === type);
}
