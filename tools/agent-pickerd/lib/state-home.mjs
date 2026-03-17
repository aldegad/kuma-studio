import os from "node:os";
import { resolve } from "node:path";
import process from "node:process";

function readEnvPath(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? resolve(value.trim()) : null;
}

export function resolveAgentPickerStateDir() {
  const explicitStateHome = readEnvPath("AGENT_PICKER_STATE_HOME");
  if (explicitStateHome) {
    return explicitStateHome;
  }

  const codexHome = readEnvPath("CODEX_HOME") ?? resolve(os.homedir(), ".codex");
  return resolve(codexHome, "agent-picker");
}
