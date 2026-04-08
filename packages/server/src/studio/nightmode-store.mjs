import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_NIGHTMODE_FLAG_PATH = "/tmp/kuma-nightmode.flag";

export function resolveNightModeFlagPath() {
  return resolve(process.env.KUMA_NIGHTMODE_FLAG || DEFAULT_NIGHTMODE_FLAG_PATH);
}

export function isNightModeEnabled(flagPath = resolveNightModeFlagPath()) {
  return existsSync(resolve(flagPath));
}

export async function setNightModeEnabled(enabled, flagPath = resolveNightModeFlagPath()) {
  const resolvedFlagPath = resolve(flagPath);

  if (enabled) {
    await mkdir(dirname(resolvedFlagPath), { recursive: true });
    await writeFile(resolvedFlagPath, `${new Date().toISOString()}\n`, "utf8");
  } else {
    await rm(resolvedFlagPath, { force: true });
  }

  return {
    enabled: Boolean(enabled),
    flagPath: resolvedFlagPath,
  };
}
