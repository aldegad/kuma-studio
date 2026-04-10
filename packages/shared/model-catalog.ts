import {
  MODEL_CATALOG as runtimeModelCatalog,
  getModelCatalogEntry as runtimeGetModelCatalogEntry,
  listModelCatalogByType as runtimeListModelCatalogByType,
} from "./model-catalog.mjs";

// Single source of truth for the set of selectable LLM models across
// kuma-studio server (team-config-store) and studio-web UI (SettingsPanel).

export type ModelType = "claude" | "codex";

export type ModelCatalogEntry = {
  /** Stable ID used by team-config and URL state */
  id: string;
  /** Which backend the option targets */
  type: ModelType;
  /** Raw model name passed to the CLI (claude -m / codex -m) */
  model: string;
  /** Human-readable dropdown label */
  label: string;
  /** Reasoning/effort level passed via CLI config — codex only */
  effort?: "low" | "medium" | "high" | "xhigh";
  /** Service tier passed via CLI config — codex only */
  serviceTier?: "default" | "fast";
  /** Canonical runtime options when an entry needs explicit CLI flags */
  options?: string;
};

export const MODEL_CATALOG = runtimeModelCatalog as readonly ModelCatalogEntry[];

export function getModelCatalogEntry(id: string): ModelCatalogEntry | undefined {
  return runtimeGetModelCatalogEntry(id) as ModelCatalogEntry | undefined;
}

export function listModelCatalogByType(type: ModelType): readonly ModelCatalogEntry[] {
  return runtimeListModelCatalogByType(type) as readonly ModelCatalogEntry[];
}
