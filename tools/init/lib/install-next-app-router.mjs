import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureDirectory } from "../../shared/project-context.mjs";
import { generateAgentPickerDrafts } from "../../../scripts/generate-agent-picker-drafts.mjs";
import { generateAgentPickerPageImports } from "../../../scripts/generate-agent-picker-page-imports.mjs";
import { syncAgentPickerScene } from "../../../scripts/sync-agent-picker-scene.mjs";
import {
  createEmptyScene,
  ensureDraftsKeepFile,
  ensureGitIgnoreEntries,
  GENERATED_BANNER,
  INIT_BANNER,
  toRelativeImportPath,
  writeJson,
  writeManagedFile,
} from "./file-utils.mjs";
import { updateHostPackageScripts, updateRootPackageScripts } from "./package-scripts.mjs";

function updateLayout(layoutPath, hostRoot, options = {}) {
  const source = readFileSync(layoutPath, "utf8");
  const agentDomPickerImportPath = toRelativeImportPath(layoutPath, path.join(hostRoot, "components", "devtools", "AgentDomPicker"));
  const importLine = `import AgentDomPicker from "${agentDomPickerImportPath}";`;
  const pickerNode = `{process.env.NODE_ENV === "development" ? <AgentDomPicker /> : null}`;

  let nextSource = source.replaceAll("DevDomPicker", "AgentDomPicker");

  if (!nextSource.includes("AgentDomPicker")) {
    const importMatches = [...nextSource.matchAll(/^import .*;$/gm)];
    if (importMatches.length === 0) {
      throw new Error(`Could not find an import block in layout: ${layoutPath}`);
    }

    const lastImport = importMatches.at(-1);
    nextSource = `${nextSource.slice(0, lastImport.index + lastImport[0].length)}\n${importLine}${nextSource.slice(lastImport.index + lastImport[0].length)}`;
  }

  if (!nextSource.includes(pickerNode)) {
    const bodyCloseIndex = nextSource.lastIndexOf("</body>");
    if (bodyCloseIndex === -1) {
      throw new Error(`Could not find </body> in layout: ${layoutPath}`);
    }

    nextSource = `${nextSource.slice(0, bodyCloseIndex)}        ${pickerNode}\n${nextSource.slice(bodyCloseIndex)}`;
  }

  if (nextSource === source) {
    return false;
  }

  if (
    !options.force &&
    !source.includes("AgentDomPicker") &&
    !source.includes("DevDomPicker") &&
    !source.includes("</body>")
  ) {
    throw new Error(`Layout patch failed safely for: ${layoutPath}`);
  }

  writeFileSync(layoutPath, nextSource, "utf8");
  return true;
}

export function installNextAppRouter(options) {
  const { projectRoot, host, packageManager, force = false } = options;
  const hostRoot = host.absPath;
  const hostPath = host.path;
  const vendorRoot = path.join(hostRoot, "vendor", "agent-picker");

  if (!existsSync(vendorRoot)) {
    throw new Error(
      `Shared engine not found at ${path.relative(projectRoot, vendorRoot) || "vendor/agent-picker"}. Add the subtree first, then run init again.`,
    );
  }

  const routeRoot = path.join(hostRoot, host.routeRoot);
  const layoutPath = host.layoutPath;
  const agentPickerAppWrapperPath = path.join(hostRoot, "components", "agent-picker", "AgentPickerApp.tsx");
  const draftsDirectoryPath = path.join(hostRoot, "components", "agent-picker", "drafts");
  const draftsKeepPath = path.join(draftsDirectoryPath, ".gitkeep");
  const agentDomPickerWrapperPath = path.join(hostRoot, "components", "devtools", "AgentDomPicker.tsx");
  const pagePath = path.join(routeRoot, "playground", "page.tsx");
  const selectionRoutePath = path.join(routeRoot, "api", "devtools", "selection", "route.ts");
  const typesPath = path.join(hostRoot, "lib", "agent-picker", "types.ts");
  const registryPath = path.join(hostRoot, "lib", "agent-picker", "registry.tsx");
  const projectItemsPath = path.join(hostRoot, "lib", "agent-picker", "project-items.tsx");
  const generatedDraftsPath = path.join(hostRoot, "lib", "agent-picker", "generated-drafts.ts");
  const generatedPageImportsPath = path.join(hostRoot, "lib", "agent-picker", "generated-page-imports.ts");
  const scenePath = path.join(projectRoot, ".agent-picker", "scene.json");
  const hostManifestPath = path.join(projectRoot, ".agent-picker", "host.json");
  const pageImportsConfigPath = path.join(projectRoot, ".agent-picker", "page-imports.json");

  const agentPickerAppImport = toRelativeImportPath(agentPickerAppWrapperPath, path.join(vendorRoot, "web", "components", "AgentPickerApp"));
  const registryImport = toRelativeImportPath(agentPickerAppWrapperPath, path.join(hostRoot, "lib", "agent-picker", "registry"));
  const agentDomPickerImport = toRelativeImportPath(agentDomPickerWrapperPath, path.join(vendorRoot, "web", "components", "devtools", "AgentDomPicker"));
  const typesImport = toRelativeImportPath(typesPath, path.join(vendorRoot, "web", "lib", "types"));
  const pageImport = toRelativeImportPath(pagePath, agentPickerAppWrapperPath);
  const selectionRouteImport = toRelativeImportPath(selectionRoutePath, path.join(vendorRoot, "web", "server", "dev-selection-route"));

  writeManagedFile(
    agentPickerAppWrapperPath,
    `${INIT_BANNER}

"use client";

import VendorAgentPickerApp from "${agentPickerAppImport}";
import { agentPickerItems, agentPickerItemsById } from "${registryImport}";

export default function AgentPickerApp() {
  return <VendorAgentPickerApp items={agentPickerItems} itemsById={agentPickerItemsById} />;
}`,
    { force },
  );

  writeManagedFile(
    agentDomPickerWrapperPath,
    `${INIT_BANNER}

export { default } from "${agentDomPickerImport}";`,
    { force },
  );

  writeManagedFile(
    pagePath,
    `${INIT_BANNER}

import type { Metadata } from "next";
import AgentPickerApp from "${pageImport}";

export const metadata: Metadata = {
  title: "Agent Picker",
  description: "Local board for comparing component and asset drafts.",
};

export default function PlaygroundPage() {
  return <AgentPickerApp />;
}`,
    { force },
  );

  writeManagedFile(
    selectionRoutePath,
    `${INIT_BANNER}

export { dynamic, GET, POST } from "${selectionRouteImport}";`,
    { force },
  );

  writeManagedFile(
    typesPath,
    `${INIT_BANNER}

export * from "${typesImport}";`,
    { force },
  );

  writeManagedFile(
    registryPath,
    `${INIT_BANNER}

import { generatedAgentPickerDraftItems } from "./generated-drafts";
import { generatedAgentPickerPageImportItems } from "./generated-page-imports";
import { projectAgentPickerItems } from "./project-items";
import type { AgentPickerComponentItem } from "./types";

export const agentPickerDraftsDirectory = "components/agent-picker/drafts";
export const agentPickerProjectRegistryPath = "src/lib/agent-picker/project-items.tsx";
export const agentPickerPageImportsConfigPath = ".agent-picker/page-imports.json";

export const agentPickerItems: AgentPickerComponentItem[] = [
  ...generatedAgentPickerDraftItems,
  ...projectAgentPickerItems,
  ...generatedAgentPickerPageImportItems,
];

export const agentPickerItemsById = new Map(agentPickerItems.map((item) => [item.id, item]));`,
    { force },
  );

  writeManagedFile(
    projectItemsPath,
    `${INIT_BANNER}

import type { AgentPickerComponentItem } from "./types";

export const projectAgentPickerItems: AgentPickerComponentItem[] = [];
`,
    { force },
  );

  writeManagedFile(
    generatedDraftsPath,
    `import type { AgentPickerComponentItem } from "./types";

${GENERATED_BANNER} Do not edit manually.
export const generatedAgentPickerDraftItems: AgentPickerComponentItem[] = [];
`,
    { force: true },
  );

  writeManagedFile(
    generatedPageImportsPath,
    `import type { AgentPickerComponentItem } from "./types";

${GENERATED_BANNER.replace("generate-agent-picker-drafts", "generate-agent-picker-page-imports")} Do not edit manually.
export const generatedAgentPickerPageImportItems: AgentPickerComponentItem[] = [];
`,
    { force: true },
  );

  ensureDirectory(draftsDirectoryPath);
  ensureDraftsKeepFile(draftsDirectoryPath, draftsKeepPath);
  if (!existsSync(scenePath)) {
    writeJson(scenePath, createEmptyScene());
  }
  if (!existsSync(pageImportsConfigPath)) {
    writeJson(pageImportsConfigPath, {
      version: 1,
      imports: [],
    });
  }

  writeJson(hostManifestPath, {
    version: 1,
    host: {
      kind: host.kind,
      path: hostPath,
      routeRoot: host.routeRoot,
      packageManager,
    },
  });

  updateLayout(layoutPath, hostRoot, { force });
  updateHostPackageScripts(path.join(hostRoot, "package.json"), packageManager);
  updateRootPackageScripts(path.join(projectRoot, "package.json"), hostPath, packageManager);
  ensureGitIgnoreEntries(projectRoot, [
    ".agent-picker/",
    `${hostPath === "." ? "" : `${hostPath}/`}public/agent-picker/drafts`,
    `${hostPath === "." ? "" : `${hostPath}/`}public/agent-picker/page-imports`,
  ]);

  generateAgentPickerDrafts(hostRoot);
  generateAgentPickerPageImports(hostRoot);
  syncAgentPickerScene(hostRoot);

  return {
    hostPath,
    routeRoot: host.routeRoot,
    layoutPath: path.relative(projectRoot, layoutPath),
  };
}
