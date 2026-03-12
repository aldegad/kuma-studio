import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHostPaths } from "../tools/shared/project-context.mjs";

const IMAGE_EXTENSIONS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const DEFAULT_CONFIG = {
  version: 1,
  imports: [],
};

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function toCategory(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "page-imports";
}

function toTags(entry) {
  const tags = Array.isArray(entry.tags) ? entry.tags.filter((value) => typeof value === "string") : [];
  const routeTags =
    typeof entry.route === "string"
      ? entry.route
          .split("/")
          .map((segment) => segment.trim().toLowerCase())
          .filter(Boolean)
      : [];
  return Array.from(new Set([...tags.map((value) => value.toLowerCase()), ...routeTags])).slice(0, 8);
}

function safeReadConfig(configPath) {
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_CONFIG;
    }

    return {
      version: parsed.version === 1 ? 1 : 1,
      imports: Array.isArray(parsed.imports) ? parsed.imports : [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function ensureConfigFile(configPath) {
  if (existsSync(configPath)) {
    return;
  }

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
}

function resolveAsset(entry, index, paths) {
  if (typeof entry.assetPath !== "string" || !entry.assetPath.trim()) {
    return null;
  }

  const rawAssetPath = entry.assetPath.trim();
  if (rawAssetPath.startsWith("/")) {
    return {
      assetUrl: rawAssetPath,
    };
  }

  const absoluteSourcePath = path.resolve(paths.projectRoot, rawAssetPath);
  const extension = path.extname(absoluteSourcePath).toLowerCase();
  if (!existsSync(absoluteSourcePath) || !IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  const titleSlug = toSlug(
    typeof entry.id === "string" && entry.id.trim()
      ? entry.id
      : typeof entry.title === "string" && entry.title.trim()
        ? entry.title
        : `page-import-${index + 1}`,
  );
  const fileName = `${titleSlug}${extension}`;
  const destinationPath = path.join(paths.publicPageImportsRoot, fileName);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(absoluteSourcePath, destinationPath);

  return {
    assetUrl: `/agent-picker/page-imports/${fileName}`,
  };
}

function toGeneratedItem(entry, index, paths) {
  if (typeof entry.title !== "string" || !entry.title.trim()) {
    return null;
  }

  const asset = resolveAsset(entry, index, paths);
  if (!asset) {
    return null;
  }

  const title = entry.title.trim();
  const idBase =
    typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : `page-import-${toSlug(title || String(index + 1)) || index + 1}`;
  const viewport =
    entry.recommendedViewport === "desktop" ||
    entry.recommendedViewport === "mobile" ||
    entry.recommendedViewport === "original"
      ? entry.recommendedViewport
      : "original";
  const route = typeof entry.route === "string" && entry.route.trim() ? entry.route.trim() : null;
  const sourceFilePath =
    typeof entry.sourceFilePath === "string" && entry.sourceFilePath.trim()
      ? entry.sourceFilePath.trim()
      : null;
  const componentPath = sourceFilePath ?? (route ? `route:${route}` : `page-import:${idBase}`);

  return `  {
    id: "${idBase}",
    title: ${JSON.stringify(title)},
    shortLabel: ${JSON.stringify(
      typeof entry.shortLabel === "string" && entry.shortLabel.trim() ? entry.shortLabel.trim() : title,
    )},
    description: ${JSON.stringify(
      typeof entry.description === "string" && entry.description.trim() ? entry.description.trim() : null,
    )},
    sourceKind: "page-import",
    category: ${JSON.stringify(toCategory(entry.category))},
    componentPath: ${JSON.stringify(componentPath)},
    sourceRoute: ${JSON.stringify(route)},
    sourceFilePath: ${JSON.stringify(sourceFilePath)},
    tags: ${JSON.stringify(toTags(entry))},
    recommendedViewport: "${viewport}",
    renderKind: "asset",
    assetUrl: ${JSON.stringify(asset.assetUrl)},
  },`;
}

export function generateAgentPickerPageImports(cwd = process.cwd()) {
  const paths = resolveHostPaths(cwd);
  const {
    pageImportsConfigPath,
    generatedPageImportsPath,
    publicPageImportsRoot,
  } = paths;

  ensureConfigFile(pageImportsConfigPath);
  mkdirSync(path.dirname(generatedPageImportsPath), { recursive: true });
  mkdirSync(publicPageImportsRoot, { recursive: true });

  const config = safeReadConfig(pageImportsConfigPath);
  const items = config.imports
    .map((entry, index) => toGeneratedItem(entry, index, paths))
    .filter(Boolean);

  const generatedSource = `import type { AgentPickerComponentItem } from "@agent-picker/workspace/types";

// Generated by scripts/generate-agent-picker-page-imports.mjs. Do not edit manually.
export const generatedAgentPickerPageImportItems: AgentPickerComponentItem[] = [
${items.join("\n")}
];
`;

  writeFileSync(generatedPageImportsPath, generatedSource, "utf8");
  process.stdout.write(`Generated ${items.length} page import items.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  generateAgentPickerPageImports();
}
