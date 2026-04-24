export type ExtensionEcosystemId = "claude" | "codex";

export interface StudioSkillEntry {
  ecosystem: ExtensionEcosystemId;
  ecosystemLabel: string;
  name: string;
  description: string;
  file: string;
  content: string;
  path: string;
}

export interface StudioPluginEntry {
  ecosystem: ExtensionEcosystemId;
  ecosystemLabel: string;
  name: string;
  displayName: string;
  description: string;
  sourcePath: string;
}

export interface ExtensionsCatalogCategory {
  id: string;
  label: string;
  markdown: string;
}

export interface ExtensionsCatalogEcosystem {
  id: string;
  label: string;
  sourcePath: string;
  available: boolean;
  categories: ExtensionsCatalogCategory[];
}

export interface ExtensionsCatalogResponse {
  ecosystems: ExtensionsCatalogEcosystem[];
}
