const recentDownloadRecords = new Map();
const pendingDownloadWaiters = new Map();
let nextDownloadWaiterId = 1;
const DOWNLOAD_MATCH_GRACE_MS = 3_000;

function normalizePermissionStatus(value) {
  return value === "allow" || value === "block" || value === "ask" ? value : "unknown";
}

function getPermissionOrigin(tab) {
  if (typeof tab?.url !== "string" || !tab.url) {
    return null;
  }

  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function createAutomaticDownloadPermissionRecord({ supported, setting, origin, error = null }) {
  const normalizedSetting = normalizePermissionStatus(setting);
  let message = "Chrome automatic-download permission diagnostics are unavailable for this page.";

  if (supported && normalizedSetting === "allow") {
    message = "Chrome currently allows repeated downloads for this site.";
  } else if (supported && normalizedSetting === "ask") {
    message = "Chrome may show a multiple-downloads permission prompt for this site.";
  } else if (supported && normalizedSetting === "block") {
    message = "Chrome is currently blocking repeated downloads for this site.";
  } else if (error) {
    message = "Kuma Picker could not read Chrome's automatic-download permission state.";
  }

  return {
    supported,
    setting: normalizedSetting,
    origin,
    allowed: normalizedSetting === "allow",
    canPrompt: normalizedSetting === "ask",
    blocked: normalizedSetting === "block",
    error,
    message,
  };
}

async function getAutomaticDownloadPermission(tab = null) {
  const origin = getPermissionOrigin(tab);
  if (!origin) {
    return createAutomaticDownloadPermissionRecord({
      supported: false,
      setting: "unknown",
      origin: null,
    });
  }

  if (!chrome.contentSettings?.automaticDownloads?.get) {
    return createAutomaticDownloadPermissionRecord({
      supported: false,
      setting: "unknown",
      origin,
    });
  }

  try {
    const details = await chrome.contentSettings.automaticDownloads.get({
      primaryUrl: tab.url,
      incognito: tab.incognito === true,
    });
    return createAutomaticDownloadPermissionRecord({
      supported: true,
      setting: details?.setting,
      origin,
    });
  } catch (error) {
    return createAutomaticDownloadPermissionRecord({
      supported: false,
      setting: "unknown",
      origin,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getDownloadPermission(tab = null) {
  return getAutomaticDownloadPermission(tab);
}

function createPermissionHint(permission) {
  if (!permission?.supported) {
    return null;
  }

  if (permission.blocked) {
    return `Chrome is blocking repeated downloads for ${permission.origin}. Allow multiple downloads for this site and retry.`;
  }

  if (permission.canPrompt) {
    return `Chrome may be waiting for the site's multiple-downloads permission prompt at ${permission.origin}. If a permission bubble appeared, allow it and retry.`;
  }

  return null;
}

function normalizeDownloadText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDownloadItem(item) {
  if (!item?.id) {
    return null;
  }

  return {
    id: item.id,
    url: normalizeDownloadText(item.url) || null,
    finalUrl: normalizeDownloadText(item.finalUrl) || null,
    referrer: normalizeDownloadText(item.referrer) || null,
    filename: normalizeDownloadText(item.filename) || null,
    mime: normalizeDownloadText(item.mime) || null,
    exists: item.exists === true,
    state: normalizeDownloadText(item.state) || "in_progress",
    danger: normalizeDownloadText(item.danger) || null,
    paused: item.paused === true,
    canResume: item.canResume === true,
    error: normalizeDownloadText(item.error) || null,
    bytesReceived: Number.isFinite(item.bytesReceived) ? item.bytesReceived : 0,
    totalBytes: Number.isFinite(item.totalBytes) ? item.totalBytes : 0,
    fileSize: Number.isFinite(item.fileSize) ? item.fileSize : 0,
    startTime: normalizeDownloadText(item.startTime) || null,
    endTime: normalizeDownloadText(item.endTime) || null,
  };
}

function rankDownloadRecords(left, right) {
  const rightTime = Date.parse(right?.endTime || right?.startTime || 0);
  const leftTime = Date.parse(left?.endTime || left?.startTime || 0);

  return rightTime - leftTime || Number(right?.id ?? 0) - Number(left?.id ?? 0);
}

function recordDownloadItem(item) {
  const record = normalizeDownloadItem(item);
  if (!record) {
    return null;
  }

  recentDownloadRecords.set(record.id, record);
  notifyPendingDownloadWaiters(record);
  return record;
}

async function refreshDownloadRecord(downloadId) {
  if (!Number.isInteger(downloadId)) {
    return null;
  }

  const [downloadItem] = await chrome.downloads.search({ id: downloadId });
  if (!downloadItem) {
    recentDownloadRecords.delete(downloadId);
    return null;
  }

  return recordDownloadItem(downloadItem);
}

function removeDownloadRecord(downloadId) {
  recentDownloadRecords.delete(downloadId);
}

function createDownloadFilter(command = {}, tab = null) {
  const targetUrl = typeof tab?.url === "string" ? tab.url : null;
  const filenameContains = normalizeDownloadText(command.filenameContains);
  const downloadUrlContains = normalizeDownloadText(command.downloadUrlContains);
  const startedAfterIso =
    typeof command.startedAfter === "string" && command.startedAfter.trim()
      ? command.startedAfter
      : new Date(Date.now() - DOWNLOAD_MATCH_GRACE_MS).toISOString();

  return {
    filenameContains: filenameContains || null,
    downloadUrlContains: downloadUrlContains || null,
    startedAfter: startedAfterIso,
    contextTargetUrl: targetUrl,
    completedOnly: command.includeInProgress !== true,
  };
}

function matchesDownloadFilter(record, filter = {}) {
  if (!record) {
    return false;
  }

  if (filter.completedOnly !== false && record.state !== "complete") {
    return false;
  }

  if (filter.startedAfter) {
    const observedAt = Date.parse(record.endTime || record.startTime || 0);
    const startedAfter = Date.parse(filter.startedAfter);
    if (Number.isFinite(startedAfter) && observedAt < startedAfter) {
      return false;
    }
  }

  if (filter.filenameContains) {
    const haystack = record.filename?.toLowerCase() || "";
    if (!haystack.includes(filter.filenameContains.toLowerCase())) {
      return false;
    }
  }

  if (filter.downloadUrlContains) {
    const needle = filter.downloadUrlContains.toLowerCase();
    const fields = [record.url, record.finalUrl, record.referrer].map((value) => value?.toLowerCase() || "");
    if (!fields.some((value) => value.includes(needle))) {
      return false;
    }
  }

  return true;
}

function findLatestMatchingDownload(filter = {}) {
  return [...recentDownloadRecords.values()].sort(rankDownloadRecords).find((record) => matchesDownloadFilter(record, filter)) ?? null;
}

function serializeDownloadResult(record, filter = {}) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    filename: record.filename,
    url: record.url,
    finalUrl: record.finalUrl,
    referrer: record.referrer,
    mime: record.mime,
    exists: record.exists,
    state: record.state,
    danger: record.danger,
    paused: record.paused,
    canResume: record.canResume,
    error: record.error,
    bytesReceived: record.bytesReceived,
    totalBytes: record.totalBytes,
    fileSize: record.fileSize,
    startTime: record.startTime,
    endTime: record.endTime,
    matchedBy: {
      filenameContains: filter.filenameContains ?? null,
      downloadUrlContains: filter.downloadUrlContains ?? null,
      startedAfter: filter.startedAfter ?? null,
      contextTargetUrl: filter.contextTargetUrl ?? null,
    },
  };
}

function serializeDownloadPermission(permission) {
  if (!permission) {
    return null;
  }

  return {
    supported: permission.supported === true,
    setting: permission.setting ?? "unknown",
    origin: permission.origin ?? null,
    allowed: permission.allowed === true,
    canPrompt: permission.canPrompt === true,
    blocked: permission.blocked === true,
    error: permission.error ?? null,
    message: permission.message ?? null,
  };
}

function notifyPendingDownloadWaiters(record) {
  for (const [waiterId, waiter] of pendingDownloadWaiters.entries()) {
    if (!matchesDownloadFilter(record, waiter.filter)) {
      continue;
    }

    pendingDownloadWaiters.delete(waiterId);
    waiter.resolve(record);
  }
}

async function waitForMatchingDownload(command = {}, tab = null) {
  const timeoutMs =
    typeof command.timeoutMs === "number" && Number.isFinite(command.timeoutMs)
      ? Math.max(100, Math.min(120_000, Math.round(command.timeoutMs)))
      : 15_000;
  const filter = createDownloadFilter(command, tab);
  const permission = await getAutomaticDownloadPermission(tab);
  const existing = findLatestMatchingDownload(filter);
  if (existing) {
    return {
      filter,
      waitedMs: 0,
      record: existing,
      permission,
    };
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const waiterId = nextDownloadWaiterId++;
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      pendingDownloadWaiters.delete(waiterId);
      const latest = findLatestMatchingDownload({
        ...filter,
        startedAfter: null,
      });
      const lastObserved = latest ? serializeDownloadResult(latest, filter) : null;
      const details = lastObserved ? ` Last observed: ${JSON.stringify(lastObserved)}.` : "";
      const hint = createPermissionHint(permission);
      const hintText = hint ? ` ${hint}` : "";
      rejectPromise(new Error(`Timed out after ${timeoutMs}ms waiting for a matching download.${details}${hintText}`));
    }, timeoutMs);

    pendingDownloadWaiters.set(waiterId, {
      filter,
      resolve(record) {
        clearTimeout(timeout);
        resolvePromise({
          filter,
          waitedMs: Date.now() - startedAt,
          record,
          permission,
        });
      },
    });
  });
}

async function getLatestDownload(command = {}, tab = null) {
  const filter = {
    ...createDownloadFilter(command, tab),
    startedAfter: null,
  };

  const records = await chrome.downloads.search({});
  for (const item of records) {
    recordDownloadItem(item);
  }

  return {
    filter,
    record: findLatestMatchingDownload(filter),
    permission: await getAutomaticDownloadPermission(tab),
  };
}

chrome.downloads?.onCreated.addListener((item) => {
  recordDownloadItem(item);
});

chrome.downloads?.onChanged.addListener((delta) => {
  if (Number.isInteger(delta?.id)) {
    void refreshDownloadRecord(delta.id);
  }
});

chrome.downloads?.onErased.addListener((downloadId) => {
  removeDownloadRecord(downloadId);
});
