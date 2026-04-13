import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOME_DIR = process.env.HOME ?? homedir() ?? ".";

export const DEFAULT_KUMA_HOME_DIR = resolve(process.env.KUMA_HOME_DIR ?? join(HOME_DIR, ".kuma"));
export const DEFAULT_KUMA_CMUX_DIR = resolve(process.env.KUMA_CMUX_DIR ?? join(DEFAULT_KUMA_HOME_DIR, "cmux"));
export const DEFAULT_KUMA_DISPATCH_DIR = resolve(process.env.KUMA_DISPATCH_DIR ?? join(DEFAULT_KUMA_HOME_DIR, "dispatch"));
export const DEFAULT_KUMA_RUNTIME_DIR = resolve(process.env.KUMA_RUNTIME_DIR ?? join(DEFAULT_KUMA_HOME_DIR, "runtime"));

export const DEFAULT_SURFACE_REGISTRY_PATH = resolve(
  process.env.KUMA_SURFACES_PATH ?? join(DEFAULT_KUMA_CMUX_DIR, "surfaces.json"),
);
export const DEFAULT_DISPATCH_TASK_DIR = resolve(
  process.env.KUMA_TASK_DIR ?? join(DEFAULT_KUMA_DISPATCH_DIR, "tasks"),
);
export const DEFAULT_DISPATCH_RESULT_DIR = resolve(
  process.env.KUMA_RESULT_DIR ?? join(DEFAULT_KUMA_DISPATCH_DIR, "results"),
);
export const DEFAULT_DISPATCH_SIGNAL_DIR = resolve(
  process.env.KUMA_SIGNAL_DIR ?? join(DEFAULT_KUMA_DISPATCH_DIR, "signals"),
);
export const DEFAULT_AUTO_INGEST_STAMP_DIR = resolve(
  process.env.KUMA_AUTO_INGEST_STAMP_DIR ?? join(DEFAULT_KUMA_RUNTIME_DIR, "vault-auto-ingest"),
);
export const DEFAULT_NIGHTMODE_FLAG_PATH = resolve(
  process.env.KUMA_NIGHTMODE_FLAG ?? join(DEFAULT_KUMA_RUNTIME_DIR, "nightmode.flag"),
);
export const DEFAULT_TEAM_RESPAWN_QUEUE_PATH = resolve(
  process.env.KUMA_TEAM_RESPAWN_QUEUE_PATH ?? join(DEFAULT_KUMA_RUNTIME_DIR, "team-respawn-queue.json"),
);
export const DEFAULT_TEAM_WATCHER_LOG_PATH = resolve(
  process.env.KUMA_TEAM_WATCHER_LOG_PATH ?? join(DEFAULT_KUMA_RUNTIME_DIR, "team-watcher.log"),
);
export const DEFAULT_LIFECYCLE_TRACE_LOG_PATH = resolve(
  process.env.KUMA_LIFECYCLE_TRACE_LOG ?? join(DEFAULT_KUMA_RUNTIME_DIR, "lifecycle-trace.log"),
);
