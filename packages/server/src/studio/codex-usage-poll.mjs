/**
 * Polls Codex usage through the same OAuth-backed route used by Codex clients.
 *
 * Primary source: GET https://chatgpt.com/backend-api/wham/usage with the
 * Codex OAuth access token from ~/.codex/auth.json. If that request fails, the
 * poller keeps the panel observable by publishing the latest local rate_limits
 * snapshot emitted into ~/.codex/sessions, marked with status "error".
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_SCAN_LIMIT = 200;
const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

function defaultSessionsDir() {
  return join(homedir(), ".codex", "sessions");
}

function defaultAuthPath() {
  return join(homedir(), ".codex", "auth.json");
}

function normalizeWindow(raw, source) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.used_percent !== "number") return null;
  const windowMinutes = typeof raw.window_minutes === "number"
    ? raw.window_minutes
    : typeof raw.limit_window_seconds === "number"
      ? raw.limit_window_seconds / 60
      : null;
  const resetsAtSeconds = typeof raw.resets_at === "number"
    ? raw.resets_at
    : typeof raw.reset_at === "number"
      ? raw.reset_at
      : null;
  return {
    utilization: raw.used_percent,
    windowMinutes,
    resetsAt: resetsAtSeconds == null ? null : new Date(resetsAtSeconds * 1000).toISOString(),
    allowed: typeof raw.allowed === "boolean" ? raw.allowed : null,
    limitReached: typeof raw.limit_reached === "boolean" ? raw.limit_reached : null,
    source,
  };
}

function normalizeCredits(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    hasCredits: Boolean(raw.has_credits),
    unlimited: Boolean(raw.unlimited),
    overageLimitReached: Boolean(raw.overage_limit_reached),
    balance: raw.balance == null ? null : String(raw.balance),
    approxLocalMessages: Array.isArray(raw.approx_local_messages) ? raw.approx_local_messages : null,
    approxCloudMessages: Array.isArray(raw.approx_cloud_messages) ? raw.approx_cloud_messages : null,
  };
}

function normalizeLogResponse(raw, source) {
  return {
    fiveHour: normalizeWindow(raw?.primary, "log"),
    sevenDay: normalizeWindow(raw?.secondary, "log"),
    credits: normalizeCredits(raw?.credits),
    planType: typeof raw?.plan_type === "string" ? raw.plan_type : null,
    limitId: typeof raw?.limit_id === "string" ? raw.limit_id : null,
    limitName: typeof raw?.limit_name === "string" ? raw.limit_name : null,
    rateLimitReachedType: raw?.rate_limit_reached_type ?? null,
    allowed: null,
    limitReached: null,
    spendControlReached: null,
    additionalRateLimits: [],
    source,
  };
}

function normalizeApiResponse(raw) {
  const additionalRateLimits = Array.isArray(raw?.additional_rate_limits)
    ? raw.additional_rate_limits.map((entry) => ({
        limitName: typeof entry?.limit_name === "string" ? entry.limit_name : null,
        meteredFeature: typeof entry?.metered_feature === "string" ? entry.metered_feature : null,
        fiveHour: normalizeWindow(entry?.rate_limit?.primary_window, "api"),
        sevenDay: normalizeWindow(entry?.rate_limit?.secondary_window, "api"),
      }))
    : [];

  return {
    fiveHour: normalizeWindow(raw?.rate_limit?.primary_window, "api"),
    sevenDay: normalizeWindow(raw?.rate_limit?.secondary_window, "api"),
    credits: normalizeCredits(raw?.credits),
    planType: typeof raw?.plan_type === "string" ? raw.plan_type : null,
    limitId: "codex",
    limitName: null,
    rateLimitReachedType: raw?.rate_limit_reached_type ?? null,
    allowed: typeof raw?.rate_limit?.allowed === "boolean" ? raw.rate_limit.allowed : null,
    limitReached: typeof raw?.rate_limit?.limit_reached === "boolean" ? raw.rate_limit.limit_reached : null,
    spendControlReached: typeof raw?.spend_control?.reached === "boolean" ? raw.spend_control.reached : null,
    additionalRateLimits,
    source: {
      type: "api",
      endpoint: USAGE_ENDPOINT,
    },
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
        data: normalizeLogResponse(rateLimits, {
          type: "log",
          path: file.path,
          line: index + 1,
          timestamp: event.timestamp ?? null,
        }),
      };
    }
  }

  return null;
}

async function loadAccessToken(authPath = defaultAuthPath()) {
  const raw = await readFile(authPath, "utf8");
  const parsed = JSON.parse(raw);
  const token = parsed?.tokens?.access_token;
  if (!token) {
    throw new Error(`${authPath} missing tokens.access_token`);
  }
  return token;
}

async function fetchUsage({ authPath, fetchImpl = fetch } = {}) {
  const token = await loadAccessToken(authPath);
  const response = await fetchImpl(USAGE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * @param {object} [options]
 * @param {number} [options.intervalMs]
 * @param {string} [options.sessionsDir]
 * @param {string} [options.authPath]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(snapshot: object) => void} [options.onUpdate]
 */
export function createCodexUsagePoller({
  intervalMs = DEFAULT_INTERVAL_MS,
  sessionsDir,
  authPath,
  fetchImpl,
  onUpdate,
} = {}) {
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
      const raw = await fetchUsage({ authPath, fetchImpl });
      publish({
        status: "ok",
        fetchedAt: new Date().toISOString(),
        error: null,
        data: normalizeApiResponse(raw),
      });
    } catch (error) {
      const latest = await readLatestRateLimitSnapshot({ sessionsDir }).catch(() => null);
      publish({
        status: "error",
        fetchedAt: latest?.fetchedAt ?? new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        data: latest?.data ?? snapshot.data,
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

