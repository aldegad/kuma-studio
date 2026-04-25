/**
 * Reads Codex rate-limit snapshots from Codex's local session event logs.
 *
 * Codex emits token_count events that include rate_limits for the 5h primary
 * window and weekly secondary window. This poller treats those emitted events
 * as the local canonical source instead of calling private OAuth endpoints.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_SCAN_LIMIT = 200;

function defaultSessionsDir() {
  return join(homedir(), ".codex", "sessions");
}

function normalizeWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.used_percent !== "number") return null;
  const resetsAtSeconds = typeof raw.resets_at === "number" ? raw.resets_at : null;
  return {
    utilization: raw.used_percent,
    windowMinutes: typeof raw.window_minutes === "number" ? raw.window_minutes : null,
    resetsAt: resetsAtSeconds == null ? null : new Date(resetsAtSeconds * 1000).toISOString(),
  };
}

function normalizeResponse(raw, source) {
  return {
    fiveHour: normalizeWindow(raw?.primary),
    sevenDay: normalizeWindow(raw?.secondary),
    credits: raw?.credits ?? null,
    planType: typeof raw?.plan_type === "string" ? raw.plan_type : null,
    limitId: typeof raw?.limit_id === "string" ? raw.limit_id : null,
    limitName: typeof raw?.limit_name === "string" ? raw.limit_name : null,
    rateLimitReachedType: raw?.rate_limit_reached_type ?? null,
    source,
  };
}

async function listJsonlFiles(dir, files = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await listJsonlFiles(path, files);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        const info = await stat(path);
        files.push({ path, mtimeMs: info.mtimeMs });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  return files;
}

function extractRateLimits(event) {
  return event?.payload?.rate_limits ?? event?.rate_limits ?? null;
}

async function readLatestRateLimitSnapshot({ sessionsDir, scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
  const files = await listJsonlFiles(sessionsDir ?? defaultSessionsDir());
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const file of files.slice(0, scanLimit)) {
    let raw = "";
    try {
      raw = await readFile(file.path, "utf8");
    } catch {
      continue;
    }

    const lines = raw.trimEnd().split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let event = null;
      try {
        event = JSON.parse(lines[index]);
      } catch {
        continue;
      }

      const rateLimits = extractRateLimits(event);
      if (!rateLimits) {
        continue;
      }

      return {
        fetchedAt: event.timestamp ?? new Date(file.mtimeMs).toISOString(),
        data: normalizeResponse(rateLimits, {
          path: file.path,
          line: index + 1,
          timestamp: event.timestamp ?? null,
        }),
      };
    }
  }

  return null;
}

/**
 * @param {object} [options]
 * @param {number} [options.intervalMs]
 * @param {string} [options.sessionsDir]
 * @param {(snapshot: object) => void} [options.onUpdate]
 */
export function createCodexUsagePoller({ intervalMs = DEFAULT_INTERVAL_MS, sessionsDir, onUpdate } = {}) {
  let timer = null;
  let snapshot = {
    status: "idle",
    fetchedAt: null,
    error: null,
    data: null,
  };

  function publish(next) {
    snapshot = next;
    if (typeof onUpdate === "function") {
      try {
        onUpdate(snapshot);
      } catch (error) {
        const details = error instanceof Error ? error.message : "unknown";
        process.stderr.write(`[codex-usage-poll] onUpdate failed: ${details}\n`);
      }
    }
  }

  async function tick() {
    try {
      const latest = await readLatestRateLimitSnapshot({ sessionsDir });
      if (!latest) {
        throw new Error("No Codex rate_limits snapshot found in ~/.codex/sessions");
      }
      publish({
        status: "ok",
        fetchedAt: latest.fetchedAt,
        error: null,
        data: latest.data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publish({
        status: "error",
        fetchedAt: new Date().toISOString(),
        error: message,
        data: snapshot.data,
      });
    }
  }

  return {
    start() {
      if (timer != null) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    },
    stop() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    },
    getSnapshot() {
      return snapshot;
    },
    async refresh() {
      await tick();
      return snapshot;
    },
  };
}

