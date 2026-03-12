import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHostPaths } from "../tools/shared/project-context.mjs";

const ASSET_EXTENSIONS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const COMPONENT_EXTENSION = ".tsx";

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function toRelativeImportPath(fromFile, toFile) {
  const relativePath = toPosix(path.relative(path.dirname(fromFile), toFile));
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function walkFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function toWords(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitle(relativePath) {
  const extension = path.extname(relativePath);
  const basename = path.basename(relativePath, extension);
  const cleaned = basename.replace(/^MadeKey/i, "").trim();
  const words = toWords(cleaned || basename);
  return words
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      if (/^\d+$/.test(token)) {
        return token.padStart(2, "0");
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

function toId(relativePath) {
  const extension = path.extname(relativePath);
  const basename = path.basename(relativePath, extension);
  const parent = path.dirname(relativePath);
  const logoDraftMatch = basename.match(/LogoDraft(\d+)$/i);
  if (logoDraftMatch) {
    return `draft-logo-${logoDraftMatch[1].padStart(2, "0")}`;
  }

  return `draft-${toPosix(path.join(parent, basename))
    .replace(/[^a-zA-Z0-9/]+/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}`;
}

function toCategory(relativePath) {
  const normalized = toPosix(relativePath);
  const segments = normalized.split("/");
  return segments.length > 1 ? segments.slice(0, -1).join("/") : "drafts";
}

function toTags(relativePath, title) {
  const pathTags = toPosix(relativePath)
    .split("/")
    .flatMap((segment) => toWords(segment.replace(/\.[^.]+$/, "")).split(/\s+/))
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  const titleTags = title
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  return Array.from(new Set([...pathTags, ...titleTags])).slice(0, 6);
}

function toImportIdentifier(relativePath) {
  const withoutExtension = relativePath.replace(/\.[^.]+$/, "");
  return withoutExtension
    .split(/[\\/]/)
    .join(" ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join("");
}

function shouldTreatAsComponent(relativePath) {
  const extension = path.extname(relativePath);
  if (extension !== COMPONENT_EXTENSION) return false;
  const basename = path.basename(relativePath, extension);
  return !basename.endsWith("Canvas");
}

export function generateAgentPickerDrafts(cwd = process.cwd()) {
  const { draftsRoot, publicDraftsRoot, generatedModulePath } = resolveHostPaths(cwd);

  mkdirSync(draftsRoot, { recursive: true });
  mkdirSync(path.dirname(generatedModulePath), { recursive: true });
  mkdirSync(publicDraftsRoot, { recursive: true });
  rmSync(publicDraftsRoot, { recursive: true, force: true });
  mkdirSync(publicDraftsRoot, { recursive: true });

  const componentFiles = [];
  const assetFiles = [];

  for (const absolutePath of walkFiles(draftsRoot)) {
    const relativePath = path.relative(draftsRoot, absolutePath);
    const extension = path.extname(relativePath).toLowerCase();

    if (shouldTreatAsComponent(relativePath)) {
      componentFiles.push(relativePath);
      continue;
    }

    if (ASSET_EXTENSIONS.has(extension)) {
      assetFiles.push(relativePath);
      const destinationPath = path.join(publicDraftsRoot, relativePath);
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      copyFileSync(absolutePath, destinationPath);
    }
  }

  componentFiles.sort((left, right) => left.localeCompare(right));
  assetFiles.sort((left, right) => left.localeCompare(right));

  const importLines = componentFiles.map((relativePath) => {
    const importIdentifier = toImportIdentifier(relativePath);
    const componentPath = path.join(draftsRoot, relativePath).replace(/\.tsx$/, "");
    const importPath = toRelativeImportPath(generatedModulePath, componentPath);
    return `import ${importIdentifier} from "${importPath}";`;
  });

  const componentItems = componentFiles.map((relativePath) => {
    const importIdentifier = toImportIdentifier(relativePath);
    const title = toTitle(relativePath);
    return `  {
    id: "${toId(relativePath)}",
    title: "${title}",
    shortLabel: "${title}",
    sourceKind: "draft",
    category: "${toCategory(relativePath)}",
    componentPath: "components/agent-picker/drafts/${toPosix(relativePath)}",
    tags: ${JSON.stringify(toTags(relativePath, title))},
    recommendedViewport: "original",
    renderKind: "component",
    Component: ${importIdentifier} as unknown as ComponentType<Record<string, unknown>>,
    props: {},
  },`;
  });

  const assetItems = assetFiles.map((relativePath) => {
    const title = toTitle(relativePath);
    return `  {
    id: "${toId(relativePath)}",
    title: "${title}",
    shortLabel: "${title}",
    sourceKind: "draft",
    category: "${toCategory(relativePath)}",
    componentPath: "components/agent-picker/drafts/${toPosix(relativePath)}",
    tags: ${JSON.stringify(toTags(relativePath, title))},
    recommendedViewport: "original",
    renderKind: "asset",
    assetUrl: "/agent-picker/drafts/${toPosix(relativePath)}",
  },`;
  });

  const generatedSource = `import type { ComponentType } from "react";
import type { AgentPickerComponentItem } from "@agent-picker/workspace/types";
${importLines.join("\n")}

// Generated by scripts/generate-agent-picker-drafts.mjs. Do not edit manually.
export const generatedAgentPickerDraftItems: AgentPickerComponentItem[] = [
${[...componentItems, ...assetItems].join("\n")}
];
`;

  writeFileSync(generatedModulePath, generatedSource, "utf8");

  const assetCount = assetFiles.length;
  const componentCount = componentFiles.length;
  process.stdout.write(`Generated ${componentCount} component drafts and ${assetCount} asset drafts.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  generateAgentPickerDrafts();
}
