import { formatSelfRunCommand, formatWorkspaceRunCommand } from "../../shared/package-manager.mjs";
import { readJson, writeJson } from "./file-utils.mjs";

function isManagedScript(value) {
  return (
    typeof value === "string" &&
    (value.includes("vendor/agent-picker") ||
      value.includes("agent-picker:prepare") ||
      value.includes("scripts/run-package-script.mjs") ||
      value.includes("scripts/dev-agent-picker.mjs"))
  );
}

export function updateHostPackageScripts(hostPackageJsonPath, packageManager) {
  const packageJson = readJson(hostPackageJsonPath);
  const scripts = { ...(packageJson.scripts ?? {}) };
  const selfRunPrepare = formatSelfRunCommand(packageManager, "agent-picker:prepare");
  const managedDevScript = "node ./vendor/agent-picker/scripts/dev-agent-picker.mjs";
  const managedPredevScript = `node ./vendor/agent-picker/scripts/run-package-script.mjs agent-picker:host-predev --optional && ${selfRunPrepare}`;
  const managedPrebuildScript = `node ./vendor/agent-picker/scripts/run-package-script.mjs agent-picker:host-prebuild --optional && ${selfRunPrepare}`;

  if (!scripts["agent-picker:host-dev"] && scripts.dev && scripts.dev !== managedDevScript && !isManagedScript(scripts.dev)) {
    scripts["agent-picker:host-dev"] = scripts.dev;
  }

  if (!scripts["agent-picker:host-dev"]) {
    scripts["agent-picker:host-dev"] = "next dev --webpack";
  }

  if (
    !scripts["agent-picker:host-predev"] &&
    scripts.predev &&
    scripts.predev !== managedPredevScript &&
    !isManagedScript(scripts.predev)
  ) {
    scripts["agent-picker:host-predev"] = scripts.predev;
  }

  if (
    !scripts["agent-picker:host-prebuild"] &&
    scripts.prebuild &&
    scripts.prebuild !== managedPrebuildScript &&
    !isManagedScript(scripts.prebuild)
  ) {
    scripts["agent-picker:host-prebuild"] = scripts.prebuild;
  }

  if (isManagedScript(scripts["agent-picker:host-predev"])) {
    delete scripts["agent-picker:host-predev"];
  }

  if (isManagedScript(scripts["agent-picker:host-prebuild"])) {
    delete scripts["agent-picker:host-prebuild"];
  }

  scripts["agent-picker:prepare"] =
    "node ./vendor/agent-picker/scripts/generate-agent-picker-drafts.mjs && node ./vendor/agent-picker/scripts/sync-agent-picker-scene.mjs";
  scripts.predev = managedPredevScript;
  scripts.prebuild = managedPrebuildScript;
  scripts.dev = managedDevScript;
  scripts["qa:agent-picker"] = scripts["qa:agent-picker"] ?? "node ./vendor/agent-picker/scripts/qa-agent-picker.mjs";

  packageJson.scripts = scripts;
  writeJson(hostPackageJsonPath, packageJson);
}

export function updateRootPackageScripts(rootPackageJsonPath, hostPath, packageManager) {
  const packageJson = readJson(rootPackageJsonPath);
  const scripts = { ...(packageJson.scripts ?? {}) };
  const vendorPrefix = hostPath === "." ? "vendor/agent-picker" : `${hostPath}/vendor/agent-picker`;

  scripts["agent-pickerd:serve"] = `node ${vendorPrefix}/tools/agent-pickerd/main.mjs serve --root .`;
  scripts["agent-pickerd:get-scene"] = `node ${vendorPrefix}/tools/agent-pickerd/main.mjs get-scene --root .`;
  scripts["agent-pickerd:get-selection"] = `node ${vendorPrefix}/tools/agent-pickerd/main.mjs get-selection --root .`;
  scripts["agent-pickerd:get-agent-note"] = `node ${vendorPrefix}/tools/agent-pickerd/main.mjs get-agent-note --root .`;
  scripts["agent-pickerd:set-agent-note"] = `node ${vendorPrefix}/tools/agent-pickerd/main.mjs set-agent-note --root .`;
  scripts["agent-pickerd:clear-agent-note"] = `node ${vendorPrefix}/tools/agent-pickerd/main.mjs clear-agent-note --root .`;
  scripts["agent-picker:web:dev"] = formatWorkspaceRunCommand(packageManager, hostPath, "dev");
  scripts["agent-picker:web:build"] = formatWorkspaceRunCommand(packageManager, hostPath, "build");

  packageJson.scripts = scripts;
  writeJson(rootPackageJsonPath, packageJson);
}
