import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CMUX_SOCKET_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "cmux",
  "cmux.sock",
);

const VOLATILE_CMUX_ENV_KEYS = [
  "CMUX_PANEL_ID",
  "CMUX_SURFACE_ID",
  "CMUX_TAB_ID",
  "CMUX_WORKSPACE_ID",
];
const STABLE_CMUX_ENV_KEYS = new Set([
  "CMUX_SOCKET",
  "CMUX_SOCKET_PATH",
  "CMUX_SOCKET_PASSWORD",
]);

function isUsableSocketPath(candidatePath) {
  if (typeof candidatePath !== "string" || candidatePath.trim().length === 0) {
    return false;
  }

  try {
    return statSync(candidatePath).isSocket();
  } catch {
    return false;
  }
}

export function resolveCmuxSocketPath(baseEnv = process.env, options = {}) {
  const preferredSocketPath =
    typeof options.preferredSocketPath === "string" && options.preferredSocketPath.trim()
      ? options.preferredSocketPath.trim()
      : DEFAULT_CMUX_SOCKET_PATH;

  const candidates = [
    preferredSocketPath,
    typeof baseEnv?.CMUX_SOCKET === "string" ? baseEnv.CMUX_SOCKET : null,
    typeof baseEnv?.CMUX_SOCKET_PATH === "string" ? baseEnv.CMUX_SOCKET_PATH : null,
  ];

  return candidates.find((candidatePath) => isUsableSocketPath(candidatePath)) ?? null;
}

export function buildCmuxEnv(baseEnv = process.env, options = {}) {
  const env = { ...baseEnv };
  const strict = options.strict === true;

  if (strict) {
    for (const key of Object.keys(env)) {
      if (key.startsWith("CMUX_") && !STABLE_CMUX_ENV_KEYS.has(key)) {
        delete env[key];
      }
    }
  } else {
    for (const key of VOLATILE_CMUX_ENV_KEYS) {
      delete env[key];
    }
  }

  const socketPath = resolveCmuxSocketPath(baseEnv, options);
  if (socketPath) {
    env.CMUX_SOCKET = socketPath;
    env.CMUX_SOCKET_PATH = socketPath;
  } else {
    delete env.CMUX_SOCKET;
    delete env.CMUX_SOCKET_PATH;
  }

  return env;
}

export function withCmuxEnv(options = {}, envOptions = {}) {
  return {
    ...options,
    env: buildCmuxEnv(options.env ?? process.env, envOptions),
  };
}
