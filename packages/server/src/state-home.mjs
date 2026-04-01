import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import process from "node:process";

function readEnvPath(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? resolve(value.trim()) : null;
}

export function resolveKumaPickerStateDir() {
  const explicitStateHome = readEnvPath("KUMA_PICKER_STATE_HOME");
  if (explicitStateHome) {
    return explicitStateHome;
  }

  const sharedHome = resolve(os.homedir(), ".kuma-picker");
  return sharedHome;
}

export function computeProjectHash(projectRoot) {
  let canonical = resolve(projectRoot);
  try {
    canonical = realpathSync(canonical);
  } catch {
    // Fall back to resolved path if realpath fails (e.g., directory not yet created).
  }
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

export function resolveProjectStateDir(projectRoot) {
  if (!projectRoot) {
    return resolveKumaPickerStateDir();
  }

  const stateHome = resolveKumaPickerStateDir();
  const hash = computeProjectHash(projectRoot);
  return resolve(stateHome, "projects", hash);
}

export function resolveProjectMetaPath(projectRoot) {
  const dir = resolveProjectStateDir(projectRoot);
  return resolve(dir, "project.json");
}
