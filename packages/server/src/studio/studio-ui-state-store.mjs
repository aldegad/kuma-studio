import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const CURRENT_VERSION = 1;
const SIDEBAR_TABS = new Set(["files", "vault"]);

function nowIso() {
  return new Date().toISOString();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegativeNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nullableString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uniqueStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.length > 0))];
}

function normalizePinnedProjectIds(value, legacyValue) {
  const ids = uniqueStringArray(value);
  const legacyId = nullableString(legacyValue);
  if (ids.length === 0 && legacyId) {
    return [legacyId];
  }
  return ids;
}

function booleanRecord(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => typeof key === "string" && typeof entry === "boolean"),
  );
}

function booleanValue(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function scrollPosition(value) {
  if (!isRecord(value)) {
    return null;
  }
  return {
    top: finiteNonNegativeNumber(value.top, 0),
    left: finiteNonNegativeNumber(value.left, 0),
  };
}

function scrollPositionRecord(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, scrollPosition(entry)])
      .filter(([key, entry]) => typeof key === "string" && entry !== null),
  );
}

function defaultState() {
  return {
    version: CURRENT_VERSION,
    updatedAt: nowIso(),
    hud: {
      pinnedProjectIds: [],
    },
    explorer: {
      open: false,
      projects: {},
    },
  };
}

function normalizeExplorerProject(value) {
  const record = isRecord(value) ? value : {};
  const sidebarTab = typeof record.sidebarTab === "string" && SIDEBAR_TABS.has(record.sidebarTab)
    ? record.sidebarTab
    : "files";

  return {
    selectedPath: nullableString(record.selectedPath),
    sidebarTab,
    expandedPaths: uniqueStringArray(record.expandedPaths),
    scrollTop: finiteNonNegativeNumber(record.scrollTop, 0),
    globalExpanded: booleanRecord(record.globalExpanded),
    vaultExpanded: booleanRecord(record.vaultExpanded),
    viewerScrollByPath: scrollPositionRecord(record.viewerScrollByPath),
  };
}

function normalizeExplorerProjects(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([projectId]) => typeof projectId === "string" && projectId.length > 0)
      .map(([projectId, projectState]) => [projectId, normalizeExplorerProject(projectState)]),
  );
}

function normalizeState(value) {
  const record = isRecord(value) ? value : {};
  const hud = isRecord(record.hud) ? record.hud : {};
  const explorer = isRecord(record.explorer) ? record.explorer : {};

  return {
    version: CURRENT_VERSION,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
    hud: {
      pinnedProjectIds: normalizePinnedProjectIds(hud.pinnedProjectIds, hud.pinnedProjectId),
    },
    explorer: {
      open: booleanValue(explorer.open, false),
      projects: normalizeExplorerProjects(explorer.projects),
    },
  };
}

function mergeExplorerProject(current, patch) {
  if (!isRecord(patch)) {
    return current;
  }

  const next = { ...current };
  if ("selectedPath" in patch) {
    next.selectedPath = nullableString(patch.selectedPath);
  }
  if ("sidebarTab" in patch && typeof patch.sidebarTab === "string" && SIDEBAR_TABS.has(patch.sidebarTab)) {
    next.sidebarTab = patch.sidebarTab;
  }
  if ("expandedPaths" in patch) {
    next.expandedPaths = uniqueStringArray(patch.expandedPaths);
  }
  if ("scrollTop" in patch) {
    next.scrollTop = finiteNonNegativeNumber(patch.scrollTop, current.scrollTop);
  }
  if ("globalExpanded" in patch && isRecord(patch.globalExpanded)) {
    next.globalExpanded = { ...current.globalExpanded, ...booleanRecord(patch.globalExpanded) };
  }
  if ("vaultExpanded" in patch && isRecord(patch.vaultExpanded)) {
    next.vaultExpanded = { ...current.vaultExpanded, ...booleanRecord(patch.vaultExpanded) };
  }
  if ("viewerScrollByPath" in patch && isRecord(patch.viewerScrollByPath)) {
    next.viewerScrollByPath = {
      ...current.viewerScrollByPath,
      ...scrollPositionRecord(patch.viewerScrollByPath),
    };
  }

  return normalizeExplorerProject(next);
}

function mergeState(current, patch) {
  const next = normalizeState(current);
  if (!isRecord(patch)) {
    return next;
  }

  if (isRecord(patch.hud) && "pinnedProjectIds" in patch.hud) {
    next.hud.pinnedProjectIds = uniqueStringArray(patch.hud.pinnedProjectIds);
  }

  if (isRecord(patch.explorer) && isRecord(patch.explorer.projects)) {
    for (const [projectId, projectPatch] of Object.entries(patch.explorer.projects)) {
      if (!projectId) {
        continue;
      }
      const currentProject = normalizeExplorerProject(next.explorer.projects[projectId]);
      next.explorer.projects[projectId] = mergeExplorerProject(currentProject, projectPatch);
    }
  }

  if (isRecord(patch.explorer) && "open" in patch.explorer) {
    next.explorer.open = booleanValue(patch.explorer.open, next.explorer.open);
  }

  next.updatedAt = nowIso();
  return normalizeState(next);
}

export class StudioUiStateStore {
  constructor({ storagePath = resolve(join(homedir(), ".kuma", "studio", "ui-state.json")) } = {}) {
    this.storagePath = storagePath;
  }

  async read() {
    if (!existsSync(this.storagePath)) {
      return defaultState();
    }

    try {
      const raw = await readFile(this.storagePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  async patch(patch) {
    const current = await this.read();
    const next = mergeState(current, patch);
    await this.#writeAtomic(next);
    return next;
  }

  async #writeAtomic(state) {
    await mkdir(dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
    await rename(tempPath, this.storagePath);
  }
}

export const __studioUiStateStoreInternals = {
  normalizeState,
  mergeState,
  defaultState,
};
