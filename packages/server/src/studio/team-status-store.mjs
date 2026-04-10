import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  classifySurfaceOutput,
  classifySurfaceStatus,
  getOutputLines,
  isIgnoredSurfaceLine,
  isPromptLine,
} from "../../../shared/surface-classifier.mjs";
import {
  normalizeSurfaceRegistry,
  parseRegistryLabel,
  readSurfaceRegistryFile,
  removeSurfacesFromRegistry,
  writeSurfaceRegistryFile,
} from "../../../shared/surface-registry.mjs";
import { normalizeAllTeams } from "../../../shared/team-normalizer.mjs";
import { withCmuxEnv } from "../cmux-env.mjs";
import { DEFAULT_TEAM_JSON_PATH } from "./team-config-store.mjs";

export { classifySurfaceStatus } from "../../../shared/surface-classifier.mjs";
export { parseRegistryLabel } from "../../../shared/surface-registry.mjs";

const DEFAULT_REGISTRY_PATH = "/tmp/kuma-surfaces.json";
const DEFAULT_REGISTRY_REFRESH_MS = 5_000;
const DEFAULT_SURFACE_POLL_MS = 5_000;
const CMUX_TREE_READ_TIMEOUT_MS = 5_000;
const SURFACE_READ_TIMEOUT_MS = 5_000;
const CMUX_SOCKET_HEAL_RETRY_DELAYS_MS = [0, 150];
const SURFACE_NOT_FOUND_PATTERN = /(?:\bno such surface\b|\bsurface(?::\d+|\s+[^\n\r]+)?\s+not found\b)/iu;
const CMUX_TREE_SURFACE_PATTERN = /\bsurface:\d+\b/gu;
const RETRYABLE_CMUX_SOCKET_FAILURE_PATTERN =
  /(?:failed to (?:write|read) to socket|failed to connect to socket|socket (?:closed|error|hang up)|broken pipe|\b(?:econnrefused|econnreset|epipe)\b)/iu;

/**
 * @typedef {"idle" | "working" | "dead"} TeamSurfaceStatus
 */

const STUDIO_MEMBER_STATE_BY_SURFACE_STATUS = {
  idle: "idle",
  working: "working",
  dead: "error",
};

function getStudioDefaultProjectId(teamId) {
  return teamId === "system" ? "system" : "kuma-studio";
}

function readStudioRosterMembers() {
  try {
    const rawTeamSchema = JSON.parse(readFileSync(DEFAULT_TEAM_JSON_PATH, "utf8"));
    const normalizedMembers = normalizeAllTeams(rawTeamSchema).members;
    return normalizedMembers.flatMap((member) => {
      const id = typeof member?.id === "string" ? member.id.trim() : "";
      const team = typeof member?.team === "string" ? member.team.trim() : "";
      const displayName = typeof member?.name?.ko === "string" ? member.name.ko.trim() : "";

      return id && team && displayName
        ? [{
            id,
            team,
            displayName,
            emoji: typeof member?.emoji === "string" ? member.emoji : "",
            role: typeof member?.role?.ko === "string" ? member.role.ko : "",
          }]
        : [];
    });
  } catch {
    return [];
  }
}

export function isRetryableCmuxSocketFailure(candidate) {
  const normalized = String(candidate ?? "").trim();
  return normalized.length > 0 && RETRYABLE_CMUX_SOCKET_FAILURE_PATTERN.test(normalized);
}

export function isSurfaceNotFoundOutput(candidate) {
  const normalized = String(candidate ?? "").trim();
  return normalized.length > 0 && SURFACE_NOT_FOUND_PATTERN.test(normalized);
}

function waitForDelay(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/**
 * @param {string} surface
 * @param {(surface: string, options?: { strictCmuxEnv?: boolean }) => Promise<{ ok: boolean, output: string }>} readSurface
 * @param {{ strictFirst?: boolean, retryDelaysMs?: number[] }} [options]
 * @returns {Promise<{ ok: boolean, output: string, healed: boolean, strictCmuxEnvUsed: boolean }>}
 */
export async function readSurfaceWithHealing(surface, readSurface, options = {}) {
  const retryDelaysMs = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs.filter((delay) => Number.isFinite(delay) && delay >= 0)
    : CMUX_SOCKET_HEAL_RETRY_DELAYS_MS;
  const strictFirst = options.strictFirst === true;
  const attempts = [
    { strictCmuxEnv: strictFirst, delayMs: 0 },
    ...retryDelaysMs.map((delayMs) => ({
      strictCmuxEnv: true,
      delayMs,
    })),
  ];

  /** @type {{ ok: boolean, output: string, healed: boolean, strictCmuxEnvUsed: boolean } | null} */
  let lastResult = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (attempt.delayMs > 0) {
      await waitForDelay(attempt.delayMs);
    }

    try {
      const result = await readSurface(surface, {
        strictCmuxEnv: attempt.strictCmuxEnv,
      });
      const normalizedResult = {
        ok: result?.ok === true,
        output: String(result?.output ?? ""),
        healed: index > 0,
        strictCmuxEnvUsed: attempt.strictCmuxEnv,
      };

      if (normalizedResult.ok || !isRetryableCmuxSocketFailure(normalizedResult.output)) {
        return normalizedResult;
      }

      lastResult = normalizedResult;
    } catch (error) {
      const normalizedError = {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
        healed: index > 0,
        strictCmuxEnvUsed: attempt.strictCmuxEnv,
      };

      if (!isRetryableCmuxSocketFailure(normalizedError.output)) {
        return normalizedError;
      }

      lastResult = normalizedError;
    }
  }

  return lastResult ?? {
    ok: false,
    output: "Error: cmux read-screen failed without a result",
    healed: false,
    strictCmuxEnvUsed: strictFirst,
  };
}

async function readCmuxTreeWithHealing(readCmuxTree, options = {}) {
  const retryDelaysMs = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs.filter((delay) => Number.isFinite(delay) && delay >= 0)
    : CMUX_SOCKET_HEAL_RETRY_DELAYS_MS;
  const strictFirst = options.strictFirst === true;
  const attempts = [
    { strictCmuxEnv: strictFirst, delayMs: 0 },
    ...retryDelaysMs.map((delayMs) => ({
      strictCmuxEnv: true,
      delayMs,
    })),
  ];

  /** @type {{ ok: boolean, output: string, healed: boolean, strictCmuxEnvUsed: boolean } | null} */
  let lastResult = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (attempt.delayMs > 0) {
      await waitForDelay(attempt.delayMs);
    }

    try {
      const result = await readCmuxTree({
        strictCmuxEnv: attempt.strictCmuxEnv,
      });
      const normalizedResult = {
        ok: result?.ok === true,
        output: String(result?.output ?? ""),
        healed: index > 0,
        strictCmuxEnvUsed: attempt.strictCmuxEnv,
      };

      if (normalizedResult.ok || !isRetryableCmuxSocketFailure(normalizedResult.output)) {
        return normalizedResult;
      }

      lastResult = normalizedResult;
    } catch (error) {
      const normalizedError = {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
        healed: index > 0,
        strictCmuxEnvUsed: attempt.strictCmuxEnv,
      };

      if (!isRetryableCmuxSocketFailure(normalizedError.output)) {
        return normalizedError;
      }

      lastResult = normalizedError;
    }
  }

  return lastResult ?? {
    ok: false,
    output: "Error: cmux tree failed without a result",
    healed: false,
    strictCmuxEnvUsed: strictFirst,
  };
}

export function parseLiveSurfacesFromCmuxTree(output) {
  return Array.from(new Set(String(output ?? "").match(CMUX_TREE_SURFACE_PATTERN) ?? []));
}

export function reconcileRegistryWithCmuxTree(registry, cmuxTreeOutput) {
  const liveSurfaces = new Set(parseLiveSurfacesFromCmuxTree(cmuxTreeOutput));
  return Object.fromEntries(
    Object.entries(normalizeSurfaceRegistry(registry)).flatMap(([projectName, projectMembers]) => {
      const nextProjectMembers = Object.fromEntries(
        Object.entries(projectMembers).flatMap(([label, surface]) =>
          liveSurfaces.has(surface)
            ? [[label, surface]]
            : [],
        ),
      );

      return Object.keys(nextProjectMembers).length > 0 ? [[projectName, nextProjectMembers]] : [];
    }),
  );
}

/**
 * @param {Record<string, Record<string, string>>} registry
 * @param {Map<string, { status: TeamSurfaceStatus, lastOutput: string }>} surfaceStates
 * @param {Map<string, { emoji: string, role: string }>} membersByName
 * @returns {{ projects: Record<string, { members: Array<{ name: string, emoji: string, role: string, surface: string, status: TeamSurfaceStatus, lastOutput: string }> }> }}
 */
export function buildTeamStatusSnapshot(registry, surfaceStates, membersByName) {
  const projects = {};

  for (const [projectName, projectMembers] of Object.entries(registry ?? {})) {
    if (!projectMembers || typeof projectMembers !== "object") {
      continue;
    }

    projects[projectName] = {
      members: getRegistryProjectMembers(projectMembers)
        .map(({ name, emoji: labelEmoji, surface }) => {
          const memberMeta = membersByName.get(name);
          const surfaceState = surfaceStates.get(surface) ?? { status: "dead", lastOutput: "" };

          return {
            name,
            emoji: labelEmoji || memberMeta?.emoji || "",
            role: memberMeta?.role || "",
            surface,
            status: surfaceState.status,
            lastOutput: surfaceState.lastOutput,
          };
        }),
    };
  }

  return { projects };
}

function createMembersByName() {
  const members = new Map();
  for (const member of readStudioRosterMembers()) {
    members.set(member.displayName, {
      id: member.id,
      emoji: member.emoji,
      role: member.role,
    });
  }

  return members;
}

function isPseudoRegistryMember(name) {
  return /\b(?:server|frontend)\b/iu.test(String(name ?? "").trim());
}

function getRegistryProjectMembers(projectMembers) {
  const dedupedMembers = new Map();

  for (const [label, surface] of Object.entries(projectMembers ?? {})) {
    if (typeof surface !== "string" || surface.trim().length === 0) {
      continue;
    }

    const { name, emoji } = parseRegistryLabel(label);
    if (isPseudoRegistryMember(name)) {
      continue;
    }

    const previous = dedupedMembers.get(name);
    dedupedMembers.set(name, {
      name,
      emoji: emoji || previous?.emoji || "",
      surface,
    });
  }

  return Array.from(dedupedMembers.values());
}

function deriveTaskFromOutput(status, lastOutputLines) {
  if (status !== "working") {
    return null;
  }

  const taskLine = [...lastOutputLines]
    .reverse()
    .find((line) => !isPromptLine(line) && !isIgnoredSurfaceLine(line));

  return taskLine ?? null;
}

function readSurfaceAssignmentsForRoster(rosterMembers, registryData) {
  try {
    const registry = normalizeSurfaceRegistry(registryData ?? readSurfaceRegistryFile(DEFAULT_REGISTRY_PATH));
    const idByDisplayName = new Map();
    for (const member of rosterMembers) {
      idByDisplayName.set(member.displayName, member.id);
    }

    const assignments = new Map();
    for (const [projectId, projectMembers] of Object.entries(registry)) {
      for (const [label, surface] of Object.entries(projectMembers ?? {})) {
        const { name } = parseRegistryLabel(label);
        if (isPseudoRegistryMember(name)) continue;
        if (typeof surface !== "string" || !surface.trim()) continue;
        const memberId = idByDisplayName.get(name);
        if (!memberId) continue;
        assignments.set(memberId, { surface, projectId });
      }
    }

    return assignments;
  } catch {
    return new Map();
  }
}

/**
 * Parse model, effort, speed, and context remaining from surface footer lines.
 *
 * Known footer patterns:
 * - Codex:  "gpt-5.4 high fast · 46% left"
 * - Claude: "esc to interrupt · /model opus[1m]"
 * - Claude: "claude-opus-4-6" (standalone or embedded)
 *
 * @param {string} output — raw surface output (typically last 3 lines)
 * @returns {{ model: string | null, effort: string | null, speed: string | null, contextRemaining: number | null } | null}
 */
export function parseModelInfo(output) {
  const lines = getOutputLines(String(output ?? ""));

  let model = null;
  let effort = null;
  let speed = null;
  let contextRemaining = null;

  for (const line of lines) {
    // Codex pattern: "gpt-5.4 high fast"
    const codexMatch = line.match(/(gpt-[\w.-]+(?:…)?)(?:\s+(low|medium|high|xhigh)(?:\s+(fast))?)?/iu);
    if (codexMatch) {
      model = normalizeCodexModelName(codexMatch[1]);
      effort = codexMatch[2]?.toLowerCase() ?? effort;
      speed = codexMatch[3]?.toLowerCase() ?? speed;
    }

    // Context pattern: "46% left"
    const contextMatch = line.match(/(\d+)%\s*left/iu);
    if (contextMatch) {
      contextRemaining = parseInt(contextMatch[1], 10);
    }

    // Claude /model command: "/model opus" or "/model opus[1m]"
    const modelCmdMatch = line.match(/\/model\s+([\w-]+)(?:\[([\w]+)\])?/iu);
    if (modelCmdMatch && !model) {
      model = modelCmdMatch[1].toLowerCase();
    }

    // Claude model identifier: "claude-opus-4-6", "claude-sonnet-4-6"
    const claudeMatch = line.match(/\b(claude-(?:opus|sonnet|haiku)-[\w.-]+)\b/iu);
    if (claudeMatch && !model) {
      model = claudeMatch[1].toLowerCase();
    }
  }

  if (!model && effort === null && speed === null && contextRemaining === null) {
    return null;
  }

  return { model, effort, speed, contextRemaining };
}

function normalizeCodexModelName(model) {
  const normalized = String(model ?? "").toLowerCase();
  if (normalized.startsWith("gpt-5.4-min")) {
    return "gpt-5.4-mini";
  }
  if (normalized.startsWith("gpt-5.4-nan")) {
    return "gpt-5.4-nano";
  }
  return normalized.replace(/…$/u, "");
}

/**
 * @param {TeamSurfaceStatus} status
 * @returns {"idle" | "working" | "error"}
 */
export function mapSurfaceStatusToStudioState(status) {
  return STUDIO_MEMBER_STATE_BY_SURFACE_STATUS[status] ?? "idle";
}

/**
 * Build the studio team status snapshot from SSOT sources.
 *
 * @param {Map<string, { status: TeamSurfaceStatus, lastOutput: string }>} surfaceStates — polled surface status
 * @param {{ updatedAt?: string, projectId?: string, registry?: Record<string, Record<string, string>> }} [options]
 * @returns {{ projects: Array<{ projectId: string, projectName: string, members: Array<{ id: string, state: "idle" | "working" | "error", lastOutputLines: string[], task: string | null, updatedAt: string | null }> }> }}
 */
export function toStudioTeamStatusSnapshot(surfaceStates, options = {}) {
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const requestedProjectId = typeof options.projectId === "string" ? options.projectId.trim() : "";
  const rosterMembers = readStudioRosterMembers();
  const surfaceAssignments = readSurfaceAssignmentsForRoster(rosterMembers, options.registry);
  const projects = new Map();

  for (const member of rosterMembers) {
    const assignment = surfaceAssignments.get(member.id);
    const surface = assignment?.surface ?? null;
    const assignedProjectId = assignment?.projectId ?? getStudioDefaultProjectId(member.team);

    if (requestedProjectId && assignedProjectId !== requestedProjectId) {
      continue;
    }

    const surfaceState = surface ? (surfaceStates?.get(surface) ?? null) : null;
    const status = surfaceState?.status ?? "idle";
    const lastOutput = surfaceState?.lastOutput ?? "";
    const { lastOutputLines } = classifySurfaceOutput(lastOutput);

    const project = projects.get(assignedProjectId) ?? {
      projectId: assignedProjectId,
      projectName: assignedProjectId,
      members: [],
    };

    project.members.push({
      id: member.id,
      surface,
      state: surfaceState ? mapSurfaceStatusToStudioState(status) : "offline",
      lastOutputLines,
      task: deriveTaskFromOutput(status, lastOutputLines),
      modelInfo: parseModelInfo(lastOutput),
      updatedAt,
    });
    projects.set(assignedProjectId, project);
  }

  return {
    projects: Array.from(projects.values()),
  };
}


async function defaultReadRegistry(registryPath) {
  return readSurfaceRegistryFile(registryPath);
}

async function defaultWriteRegistry(registryPath, registry) {
  writeSurfaceRegistryFile(registryPath, registry);
}

async function defaultReadCmuxTree(options = {}) {
  return new Promise((resolve) => {
    execFile(
      "cmux",
      ["tree"],
      withCmuxEnv({
        encoding: "utf8",
        timeout: CMUX_TREE_READ_TIMEOUT_MS,
      }, {
        strict: options.strictCmuxEnv === true,
      }),
      (error, stdout = "", stderr = "") => {
        const output = `${stdout}${stderr}`.trim();
        if (error) {
          resolve({ ok: false, output: output || error.message });
          return;
        }

        resolve({ ok: true, output });
      },
    );
  });
}

async function defaultReadSurface(surface, options = {}) {
  return new Promise((resolve) => {
    execFile(
      "cmux",
      ["read-screen", "--surface", surface, "--lines", "10"],
      withCmuxEnv({
        encoding: "utf8",
        timeout: SURFACE_READ_TIMEOUT_MS,
      }, {
        strict: options.strictCmuxEnv === true,
      }),
      (error, stdout = "", stderr = "") => {
        const output = `${stdout}${stderr}`.trim();
        if (error) {
          resolve({ ok: false, output: output || error.message });
          return;
        }

        resolve({ ok: true, output });
      },
    );
  });
}

function snapshotStructureKey(snapshot) {
  return JSON.stringify({
    projects: Object.fromEntries(
      Object.entries(snapshot?.projects ?? {}).map(([projectName, project]) => [
        projectName,
        {
          members: (project?.members ?? []).map((member) => ({
            name: member.name,
            emoji: member.emoji,
            role: member.role,
            surface: member.surface,
          })),
        },
      ]),
    ),
  });
}

function snapshotStatusKey(snapshot) {
  return JSON.stringify({
    projects: Object.fromEntries(
      Object.entries(snapshot?.projects ?? {}).map(([projectName, project]) => [
        projectName,
        {
          members: (project?.members ?? []).map((member) => ({
            surface: member.surface,
            status: member.status,
          })),
        },
      ]),
    ),
  });
}

function cloneSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

export class TeamStatusStore {
  #registryPath;
  #registryRefreshMs;
  #surfacePollMs;
  #readRegistry;
  #writeRegistry;
  #readSurface;
  #readCmuxTree;
  #membersByName = createMembersByName();
  #rawRegistry = {};
  #registry = {};
  #surfaceStates = new Map();
  #snapshot = { projects: {} };
  #listeners = new Set();
  #registryTimer = null;
  #surfaceTimer = null;
  #refreshingRegistry = false;
  #pollingSurfaces = false;
  #preferStrictCmuxEnv = false;

  /**
   * @param {{
   *   registryPath?: string,
   *   registryRefreshMs?: number,
   *   surfacePollMs?: number,
   *   readRegistryFn?: (registryPath: string) => Promise<Record<string, Record<string, string>>>,
   *   writeRegistryFn?: (registryPath: string, registry: Record<string, Record<string, string>>) => Promise<void>,
   *   readSurfaceFn?: (surface: string, options?: { strictCmuxEnv?: boolean }) => Promise<{ ok: boolean, output: string }>,
   *   readCmuxTreeFn?: (options?: { strictCmuxEnv?: boolean }) => Promise<{ ok: boolean, output: string }>,
   * }} [options]
   */
  constructor(options = {}) {
    this.#registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
    this.#registryRefreshMs = options.registryRefreshMs ?? DEFAULT_REGISTRY_REFRESH_MS;
    this.#surfacePollMs = options.surfacePollMs ?? DEFAULT_SURFACE_POLL_MS;
    this.#readRegistry = options.readRegistryFn ?? defaultReadRegistry;
    this.#writeRegistry = options.writeRegistryFn ?? defaultWriteRegistry;
    this.#readSurface = options.readSurfaceFn ?? defaultReadSurface;
    this.#readCmuxTree = options.readCmuxTreeFn ?? defaultReadCmuxTree;
  }

  start() {
    void this.refreshRegistry();
    void this.pollSurfaces();

    if (this.#registryTimer == null) {
      this.#registryTimer = setInterval(() => {
        void this.refreshRegistry();
      }, this.#registryRefreshMs);
      this.#registryTimer.unref?.();
    }

    if (this.#surfaceTimer == null) {
      this.#surfaceTimer = setInterval(() => {
        void this.pollSurfaces();
      }, this.#surfacePollMs);
      this.#surfaceTimer.unref?.();
    }
  }

  close() {
    if (this.#registryTimer != null) {
      clearInterval(this.#registryTimer);
      this.#registryTimer = null;
    }

    if (this.#surfaceTimer != null) {
      clearInterval(this.#surfaceTimer);
      this.#surfaceTimer = null;
    }

    this.#listeners.clear();
  }

  getSnapshot() {
    return cloneSnapshot(this.#snapshot);
  }

  getMembersByName() {
    return this.#membersByName;
  }

  getSurfaceStates() {
    return new Map(this.#surfaceStates);
  }

  /**
   * @param {(snapshot: { projects: Record<string, { members: Array<{ name: string, emoji: string, role: string, surface: string, status: TeamSurfaceStatus, lastOutput: string }> }> }) => void} listener
   * @returns {() => void}
   */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async refreshRegistry() {
    if (this.#refreshingRegistry) {
      return this.getSnapshot();
    }

    this.#refreshingRegistry = true;

    try {
      this.#membersByName = createMembersByName();
      const rawRegistry = normalizeSurfaceRegistry(await this.#readRegistry(this.#registryPath));
      const reconciledRegistry = await this.#reconcileRegistryAgainstCmuxTree(rawRegistry);
      this.#setRegistry(reconciledRegistry);

      const nextSnapshot = buildTeamStatusSnapshot(this.#registry, this.#surfaceStates, this.#membersByName);
      const changed = this.#commitSnapshot(nextSnapshot, { notifyOnStructureChange: true });

      if (changed) {
        void this.pollSurfaces();
      }

      return this.getSnapshot();
    } catch (error) {
      process.stderr.write(
        `[team-status] Registry refresh failed (${this.#registryPath}): ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return this.getSnapshot();
    } finally {
      this.#refreshingRegistry = false;
    }
  }

  async pollSurfaces() {
    if (this.#pollingSurfaces) {
      return this.getSnapshot();
    }

    const surfaces = this.#listSurfaces();
    if (surfaces.length === 0) {
      return this.getSnapshot();
    }

    this.#pollingSurfaces = true;

    try {
      const results = await Promise.all(
        surfaces.map(async (surface) => {
          const state = await this.#readSurfaceState(surface);
          return { surface, state };
        }),
      );

      for (const { surface, state } of results) {
        this.#surfaceStates.set(surface, state);
      }

      const staleSurfaces = results
        .filter(({ state }) => isSurfaceNotFoundOutput(state.lastOutput))
        .map(({ surface }) => surface);
      const staleRegistryRemoved = await this.#removeStaleRegistrySurfaces(staleSurfaces);
      if (staleRegistryRemoved) {
        const previouslyPolledSurfaces = new Set(results.map(({ surface }) => surface));
        const newlyTrackedSurfaces = this.#listSurfaces()
          .filter((surface) => !previouslyPolledSurfaces.has(surface));

        if (newlyTrackedSurfaces.length > 0) {
          const followUpResults = await Promise.all(
            newlyTrackedSurfaces.map(async (surface) => ({
              surface,
              state: await this.#readSurfaceState(surface),
            })),
          );

          for (const { surface, state } of followUpResults) {
            this.#surfaceStates.set(surface, state);
          }
        }
      }

      this.#membersByName = createMembersByName();
      this.#commitSnapshot(
        buildTeamStatusSnapshot(this.#registry, this.#surfaceStates, this.#membersByName),
        { notifyOnStructureChange: staleRegistryRemoved },
      );

      return this.getSnapshot();
    } finally {
      this.#pollingSurfaces = false;
    }
  }

  #listSurfaces() {
    return Array.from(
      new Set(
        Object.values(this.#registry)
          .flatMap((projectMembers) => getRegistryProjectMembers(projectMembers))
          .map(({ surface }) => surface),
      ),
    );
  }

  #setRegistry(rawRegistry) {
    this.#rawRegistry = normalizeSurfaceRegistry(rawRegistry);
    this.#registry = this.#rawRegistry;
    this.#pruneSurfaceStates();
  }

  #pruneSurfaceStates() {
    const trackedSurfaces = new Set(this.#listSurfaces());
    for (const surface of this.#surfaceStates.keys()) {
      if (!trackedSurfaces.has(surface)) {
        this.#surfaceStates.delete(surface);
      }
    }
  }

  #commitSnapshot(nextSnapshot, { notifyOnStructureChange }) {
    const prevSnapshot = this.#snapshot;
    const structureChanged = snapshotStructureKey(prevSnapshot) !== snapshotStructureKey(nextSnapshot);
    const statusChanged = snapshotStatusKey(prevSnapshot) !== snapshotStatusKey(nextSnapshot);
    const fullChanged = JSON.stringify(prevSnapshot) !== JSON.stringify(nextSnapshot);

    if (!fullChanged) {
      return false;
    }

    this.#snapshot = nextSnapshot;

    if (statusChanged || (notifyOnStructureChange && structureChanged)) {
      const cloned = cloneSnapshot(nextSnapshot);
      for (const listener of this.#listeners) {
        try {
          listener(cloned);
        } catch (error) {
          process.stderr.write(
            `[team-status] Listener error: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
    }

    return true;
  }

  async #reconcileRegistryAgainstCmuxTree(rawRegistry) {
    const treeResult = await readCmuxTreeWithHealing(this.#readCmuxTree, {
      strictFirst: this.#preferStrictCmuxEnv,
    });
    if (treeResult.strictCmuxEnvUsed) {
      this.#preferStrictCmuxEnv = true;
    }

    if (!treeResult.ok) {
      return normalizeSurfaceRegistry(rawRegistry);
    }

    const normalizedRegistry = normalizeSurfaceRegistry(rawRegistry);
    const reconciledRegistry = reconcileRegistryWithCmuxTree(normalizedRegistry, treeResult.output);
    await this.#persistRegistryIfChanged(normalizedRegistry, reconciledRegistry);
    return reconciledRegistry;
  }

  async #removeStaleRegistrySurfaces(surfaces) {
    const staleSurfaces = Array.from(
      new Set(
        Array.from(surfaces ?? [])
          .map((surface) => String(surface ?? "").trim())
          .filter(Boolean),
      ),
    );

    if (staleSurfaces.length === 0) {
      return false;
    }

    const nextRawRegistry = removeSurfacesFromRegistry(this.#rawRegistry, staleSurfaces);
    const changed = JSON.stringify(nextRawRegistry) !== JSON.stringify(this.#rawRegistry);
    if (!changed) {
      return false;
    }

    await this.#persistRegistryIfChanged(this.#rawRegistry, nextRawRegistry);
    this.#setRegistry(nextRawRegistry);
    return true;
  }

  async #persistRegistryIfChanged(previousRegistry, nextRegistry) {
    const normalizedPrevious = normalizeSurfaceRegistry(previousRegistry);
    const normalizedNext = normalizeSurfaceRegistry(nextRegistry);
    if (JSON.stringify(normalizedPrevious) === JSON.stringify(normalizedNext)) {
      return;
    }

    await this.#writeRegistry(this.#registryPath, normalizedNext);
  }

  async #readSurfaceState(surface) {
    const result = await readSurfaceWithHealing(surface, this.#readSurface, {
      strictFirst: this.#preferStrictCmuxEnv,
    });
    if (result.strictCmuxEnvUsed) {
      this.#preferStrictCmuxEnv = true;
    }

    const output = String(result?.output ?? "").trim();
    return {
      status: result?.ok ? classifySurfaceStatus(output) : "dead",
      lastOutput: output,
    };
  }
}
