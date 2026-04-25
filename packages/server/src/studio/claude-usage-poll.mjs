/**
 * Polls Anthropic's undocumented OAuth usage endpoint to surface
 * Claude Code 5h / weekly / extra-usage limits in the studio dashboard.
 *
 * Endpoint: GET https://api.anthropic.com/api/oauth/usage
 * Header:   anthropic-beta: oauth-2025-04-20
 * Auth:     Bearer <claudeAiOauth.accessToken>
 *
 * The OAuth token lives in the macOS Keychain under service
 * "Claude Code-credentials" on macOS, or in ~/.claude/.credentials.json
 * on Linux. Same source the Claude Code CLI itself reads.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const BETA_HEADER = "oauth-2025-04-20";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const RATE_LIMIT_BACKOFF_MS = 15 * 60_000;

async function readKeychainToken() {
  const { stdout } = await execFileAsync("security", [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-w",
  ]);
  const parsed = JSON.parse(stdout.trim());
  const token = parsed?.claudeAiOauth?.accessToken;
  if (!token) {
    throw new Error("Keychain entry missing claudeAiOauth.accessToken");
  }
  return token;
}

async function readFileToken() {
  const path = join(homedir(), ".claude", ".credentials.json");
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  const token = parsed?.claudeAiOauth?.accessToken;
  if (!token) {
    throw new Error(`Credentials file ${path} missing claudeAiOauth.accessToken`);
  }
  return token;
}

async function loadOauthToken() {
  if (platform() === "darwin") {
    return readKeychainToken();
  }
  return readFileToken();
}

function normalizeBucket(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.utilization !== "number") return null;
  return {
    utilization: raw.utilization,
    resetsAt: raw.resets_at ?? null,
  };
}

function normalizeExtra(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    isEnabled: Boolean(raw.is_enabled),
    monthlyLimit: typeof raw.monthly_limit === "number" ? raw.monthly_limit : null,
    usedCredits: typeof raw.used_credits === "number" ? raw.used_credits : null,
    utilization: typeof raw.utilization === "number" ? raw.utilization : null,
    currency: raw.currency ?? null,
  };
}

function normalizeResponse(raw) {
  return {
    fiveHour: normalizeBucket(raw?.five_hour),
    sevenDay: normalizeBucket(raw?.seven_day),
    sevenDayOpus: normalizeBucket(raw?.seven_day_opus),
    sevenDaySonnet: normalizeBucket(raw?.seven_day_sonnet),
    sevenDayOmelette: normalizeBucket(raw?.seven_day_omelette),
    extraUsage: normalizeExtra(raw?.extra_usage),
  };
}

class UsageHttpError extends Error {
  constructor(status, body, retryAfterMs) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

async function fetchUsage(token) {
  const response = await fetch(ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": BETA_HEADER,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    throw new UsageHttpError(response.status, body, retryAfterMs);
  }
  return response.json();
}

/**
 * @param {object} [options]
 * @param {number} [options.intervalMs]
 * @param {(snapshot: object) => void} [options.onUpdate]
 */
export function createClaudeUsagePoller({ intervalMs = DEFAULT_INTERVAL_MS, onUpdate } = {}) {
  let timer = null;
  let stopped = false;
  let lastFetchedAtMs = 0;
  let snapshot = {
    status: "idle",
    fetchedAt: null,
    error: null,
    data: null,
    okFetchedAt: null,
  };

  function publish(next) {
    snapshot = next;
    if (typeof onUpdate === "function") {
      try {
        onUpdate(snapshot);
      } catch (error) {
        const details = error instanceof Error ? error.message : "unknown";
        process.stderr.write(`[claude-usage-poll] onUpdate failed: ${details}\n`);
      }
    }
  }

  function scheduleNext(delayMs) {
    if (stopped) return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  }

  async function tick() {
    lastFetchedAtMs = Date.now();
    try {
      const token = await loadOauthToken();
      const raw = await fetchUsage(token);
      publish({
        status: "ok",
        fetchedAt: new Date().toISOString(),
        error: null,
        data: normalizeResponse(raw),
        okFetchedAt: new Date().toISOString(),
      });
      scheduleNext(intervalMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited = error instanceof UsageHttpError && error.status === 429;
      publish({
        status: "error",
        fetchedAt: new Date().toISOString(),
        error: message,
        data: snapshot.data,
        okFetchedAt: snapshot.okFetchedAt,
      });
      const retryAfterMs = error instanceof UsageHttpError ? error.retryAfterMs : null;
      const backoff = isRateLimited
        ? (retryAfterMs ?? RATE_LIMIT_BACKOFF_MS)
        : intervalMs;
      scheduleNext(backoff);
    }
  }

  return {
    start() {
      if (timer != null || stopped) return;
      void tick();
    },
    stop() {
      stopped = true;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    getSnapshot() {
      return snapshot;
    },
    async refresh({ minIntervalMs = 30_000 } = {}) {
      const sinceLast = Date.now() - lastFetchedAtMs;
      if (sinceLast < minIntervalMs) {
        return snapshot;
      }
      await tick();
      return snapshot;
    },
  };
}
