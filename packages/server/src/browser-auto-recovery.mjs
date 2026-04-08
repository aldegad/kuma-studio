import { execSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { fetchJson, normalizeDaemonUrl } from "./automation-client.mjs";

export const MAX_AUTO_RECOVERY_ATTEMPTS = 3;
export const SCREENSHOT_AUTO_RETRY_DELAY_MS = 1_000;
export const URL_MATCH_AUTO_RETRY_DELAY_MS = 1_000;
export const BROWSER_SESSION_AUTO_RETRY_DELAY_MS = 5_000;
export const FINAL_BROWSER_CONNECTION_FAILURE_MESSAGE =
  "Browser connection failed after 3 attempts. Check if Kuma Picker extension is installed and enabled in Chrome.";

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

export function isNoBrowserConnectionError(error) {
  const message = asError(error).message;
  return (
    message.includes("No active browser connection") ||
    message.includes("No browser connection")
  );
}

export function isImageReadbackFailedError(error) {
  return asError(error).message.toLowerCase().includes("image readback failed");
}

export function isMissingTargetTabError(error) {
  const message = asError(error).message;
  return (
    message.includes("No browser tab matches the requested URL fragment:") ||
    message.includes("No browser tab matches the requested URL:")
  );
}

function normalizeRecoveryUrl(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!trimmed) {
    return null;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(trimmed) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed)) {
    return trimmed;
  }

  if (/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/u.test(trimmed)) {
    return `http://${trimmed}`;
  }

  if (/^[^/\s]+\.[^/\s]+(?:\/.*)?$/u.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

function createDefaultRecoveryUrl(daemonUrl) {
  try {
    const url = new URL(normalizeDaemonUrl(daemonUrl));
    url.pathname = "/studio";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:4312/studio";
  }
}

export function inferRecoveryUrlFromTargets(targets = {}, daemonUrl = null) {
  return (
    normalizeRecoveryUrl(targets?.targetUrl) ??
    normalizeRecoveryUrl(targets?.targetUrlContains) ??
    createDefaultRecoveryUrl(daemonUrl)
  );
}

export async function readBrowserSessionSummary(daemonUrl) {
  return fetchJson(`${normalizeDaemonUrl(daemonUrl)}/browser-session`, {
    method: "GET",
    headers: {},
  });
}

export function hasActiveBrowserSession(summary) {
  return summary?.connected === true;
}

export async function resolveCurrentPageUrl({
  daemonUrl,
  targets,
  readBrowserSessionSummaryFn = readBrowserSessionSummary,
} = {}) {
  try {
    const session = await readBrowserSessionSummaryFn(daemonUrl);
    const currentPageUrl =
      session?.page?.url ??
      (Array.isArray(session?.tabs)
        ? session.tabs.find((tab) => typeof tab?.page?.url === "string" && tab.page.url)?.page?.url
        : null);

    return normalizeRecoveryUrl(currentPageUrl) ?? inferRecoveryUrlFromTargets(targets, daemonUrl);
  } catch {
    return inferRecoveryUrlFromTargets(targets, daemonUrl);
  }
}

export async function readBrowserSessionWithAutoRecovery({
  daemonUrl,
  targets = {},
  openBrowserFn = openBrowserUrl,
  delayFn = delay,
  logFn = defaultAutoRecoveryLogger,
  readBrowserSessionSummaryFn = readBrowserSessionSummary,
} = {}) {
  let lastSummary = null;

  for (let attempt = 1; attempt <= MAX_AUTO_RECOVERY_ATTEMPTS; attempt += 1) {
    lastSummary = await readBrowserSessionSummaryFn(daemonUrl);
    if (hasActiveBrowserSession(lastSummary)) {
      return lastSummary;
    }

    if (attempt >= MAX_AUTO_RECOVERY_ATTEMPTS) {
      return lastSummary;
    }

    const recoveryUrl = inferRecoveryUrlFromTargets(targets, daemonUrl);
    logFn(
      `No active browser session. Auto-opening browser and retrying... (attempt ${attempt + 1}/${MAX_AUTO_RECOVERY_ATTEMPTS})`,
    );
    openBrowserFn(recoveryUrl);
    await delayFn(BROWSER_SESSION_AUTO_RETRY_DELAY_MS);
  }

  return lastSummary;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

export function openBrowserUrl(url, { execSyncImpl = execSync } = {}) {
  const normalizedUrl = normalizeRecoveryUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  execSyncImpl(`/usr/bin/open ${shellQuote(normalizedUrl)}`, {
    stdio: "ignore",
  });
  return normalizedUrl;
}

function defaultAutoRecoveryLogger(message) {
  process.stderr.write(`${message}\n`);
}

export async function runWithBrowserAutoRecovery({
  execute,
  daemonUrl,
  targets,
  allowImageReadbackRetry = false,
  openBrowserFn = openBrowserUrl,
  delayFn = delay,
  logFn = defaultAutoRecoveryLogger,
  readBrowserSessionSummaryFn = readBrowserSessionSummary,
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_AUTO_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      lastError = asError(error);

      if (attempt >= MAX_AUTO_RECOVERY_ATTEMPTS) {
        if (isNoBrowserConnectionError(lastError)) {
          throw new Error(FINAL_BROWSER_CONNECTION_FAILURE_MESSAGE);
        }
        throw lastError;
      }

      if (isNoBrowserConnectionError(lastError)) {
        const recoveryUrl = inferRecoveryUrlFromTargets(targets, daemonUrl);
        logFn(`No browser connection. Auto-opening browser and retrying... (attempt ${attempt + 1}/${MAX_AUTO_RECOVERY_ATTEMPTS})`);
        openBrowserFn(recoveryUrl);
        await delayFn(5_000);
        continue;
      }

      if (isMissingTargetTabError(lastError)) {
        const recoveryUrl = inferRecoveryUrlFromTargets(targets, daemonUrl);
        logFn(
          `No matching browser tab. Auto-opening target URL and retrying... (attempt ${attempt + 1}/${MAX_AUTO_RECOVERY_ATTEMPTS})`,
        );
        openBrowserFn(recoveryUrl);
        await delayFn(URL_MATCH_AUTO_RETRY_DELAY_MS);
        continue;
      }

      if (allowImageReadbackRetry && isImageReadbackFailedError(lastError)) {
        const recoveryUrl = await resolveCurrentPageUrl({
          daemonUrl,
          targets,
          readBrowserSessionSummaryFn,
        });
        logFn(
          `Screenshot image readback failed. Auto-activating browser tab and retrying... (attempt ${attempt + 1}/${MAX_AUTO_RECOVERY_ATTEMPTS})`,
        );
        openBrowserFn(recoveryUrl);
        await delayFn(SCREENSHOT_AUTO_RETRY_DELAY_MS);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error(FINAL_BROWSER_CONNECTION_FAILURE_MESSAGE);
}
