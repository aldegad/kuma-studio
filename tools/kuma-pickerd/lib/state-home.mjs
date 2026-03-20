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

  const codexHome = readEnvPath("CODEX_HOME");
  if (codexHome) {
    return resolve(codexHome, "kuma-picker");
  }

  return resolve(os.homedir(), ".kuma-picker");
}
