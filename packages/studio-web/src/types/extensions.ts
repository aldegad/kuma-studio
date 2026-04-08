export interface StudioSkillEntry {
  name: string;
  description: string;
  file: string;
  content: string;
  path: string;
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
