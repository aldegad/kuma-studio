import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const PRIMARY_STATE_DIR = ".agent-picker";

function stripJsonComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
}

function readJsonWithComments(filePath) {
  return JSON.parse(stripJsonComments(readFileSync(filePath, "utf8")));
}

function detectAliasRoot(hostRoot) {
  const configCandidates = ["tsconfig.json", "jsconfig.json"];

  for (const configName of configCandidates) {
    const configPath = path.join(hostRoot, configName);
    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const config = readJsonWithComments(configPath);
      const candidate =
        config.compilerOptions?.paths?.["@/*"]?.[0] ??
        config.compilerOptions?.paths?.["@/*"];

      if (typeof candidate === "string") {
        const normalized = candidate.replace(/^\.\//, "").replace(/\/\*$/, "");
        if (normalized && normalized !== "*") {
          return normalized;
        }
      }
    } catch {
      continue;
    }
  }

  return existsSync(path.join(hostRoot, "src")) ? "src" : ".";
}

export function resolveProjectRoot(cwd = process.cwd()) {
  const start = path.resolve(cwd);
  const configuredRoot = process.env.AGENT_PICKER_PROJECT_ROOT;

  if (configuredRoot) {
    return path.resolve(start, configuredRoot);
  }

  let current = start;
  while (true) {
    if (existsSync(path.join(current, PRIMARY_STATE_DIR))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }

    current = parent;
  }
}

export function resolveHostRoot(cwd = process.cwd()) {
  return path.resolve(cwd);
}

export function resolveHostPaths(cwd = process.cwd()) {
  const hostRoot = resolveHostRoot(cwd);
  const projectRoot = resolveProjectRoot(cwd);
  const codeRootRelative = process.env.AGENT_PICKER_CODE_ROOT ?? detectAliasRoot(hostRoot);
  const codeRoot = path.resolve(
    hostRoot,
    codeRootRelative === "." ? "" : codeRootRelative,
  );

  return {
    hostRoot,
    projectRoot,
    codeRoot,
    codeRootRelative,
    draftsRoot: path.join(codeRoot, "components", "agent-picker", "drafts"),
    publicDraftsRoot: path.join(hostRoot, "public", "agent-picker", "drafts"),
    generatedModulePath: path.join(
      codeRoot,
      "lib",
      "agent-picker",
      "generated-drafts.ts",
    ),
    generatedPageImportsPath: path.join(
      codeRoot,
      "lib",
      "agent-picker",
      "generated-page-imports.ts",
    ),
    publicScenePath: path.join(hostRoot, "public", "agent-picker", "scene.json"),
    publicPageImportsRoot: path.join(hostRoot, "public", "agent-picker", "page-imports"),
    scenePath: path.join(projectRoot, PRIMARY_STATE_DIR, "scene.json"),
    pageImportsConfigPath: path.join(projectRoot, PRIMARY_STATE_DIR, "page-imports.json"),
    hostManifestPath: path.join(projectRoot, PRIMARY_STATE_DIR, "host.json"),
  };
}

export function ensureDirectory(directoryPath) {
  mkdirSync(directoryPath, { recursive: true });
}

export function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
