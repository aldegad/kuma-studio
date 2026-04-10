import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import {
  classifySurfaceOutput,
  classifySurfaceStatus,
  getOutputLines,
  isIgnoredSurfaceLine,
  isPromptLine,
} from "../../../shared/surface-classifier.mjs";
import { withCmuxEnv } from "../cmux-env.mjs";
import { getMembersById } from "../team-metadata.mjs";

export { classifySurfaceStatus } from "../../../shared/surface-classifier.mjs";

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

const IMPLICIT_REGISTRY_MEMBERS = Array.from(getMembersById().values())
  .filter((member) => member.team === "system" && typeof member.defaultSurface === "string" && member.defaultSurface)
  .map((member) => ({
    project: "system",
    name: member.name.ko,
    emoji: member.emoji,
    surface: member.defaultSurface,
  }));

function formatRegistryLabel(name, emoji = "") {
  const normalizedName = String(name ?? "").trim();
  const normalizedEmoji = String(emoji ?? "").trim();
  return normalizedEmoji && normalizedName ? `${normalizedEmoji} ${normalizedName}` : normalizedName;
}

function cloneRegistryProjects(registry) {
  return Object.fromEntries(
    Object.entries(registry ?? {}).flatMap(([projectName, projectMembers]) =>
      projectMembers && typeof projectMembers === "object" && !Array.isArray(projectMembers)
        ? [[projectName, { ...projectMembers }]]
        : [],
    ),
  );
}

function hasRegistryEntries(registry) {
  return Object.values(registry ?? {}).some(
    (projectMembers) => projectMembers && typeof projectMembers === "object" && Object.keys(projectMembers).length > 0,
  );
}

function hasRegistryMember(registry, memberName) {
  const normalizedName = String(memberName ?? "").trim();
  if (!normalizedName) {
    return false;
  }

  for (const projectMembers of Object.values(registry ?? {})) {
    if (!projectMembers || typeof projectMembers !== "object") {
      continue;
    }

    for (const label of Object.keys(projectMembers)) {
      if (parseRegistryLabel(label).name === normalizedName) {
        return true;
      }
    }
  }

  return false;
}

export function withImplicitRegistryMembers(registry) {
  const next = cloneRegistryProjects(registry);

  if (!hasRegistryEntries(next)) {
    return next;
  }

  for (const member of IMPLICIT_REGISTRY_MEMBERS) {
    if (hasRegistryMember(next, member.name)) {
      continue;
    }

    next[member.project] = {
      ...(next[member.project] ?? {}),
      [formatRegistryLabel(member.name, member.emoji)]: member.surface,
    };
  }

  return next;
}

/**
 * Strip a leading emoji prefix such as "🦫 뚝딱이" down to the display name.
 * @param {string} label
 * @returns {{ name: string, emoji: string }}
 */
export function parseRegistryLabel(label) {
  const text = String(label ?? "").trim();
  const emojiMatch = text.match(/^[\p{Extended_Pictographic}\uFE0F\s]+/u);
  const emojiPrefix = emojiMatch?.[0] ?? "";
  const name = text.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || text;
  const emoji = emojiPrefix.replace(/\s+/gu, "").trim();
  return { name, emoji };
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

function normalizeRegistry(registry) {
  return Object.fromEntries(
    Object.entries(registry ?? {}).flatMap(([projectName, projectMembers]) => {
      if (!projectMembers || typeof projectMembers !== "object" || Array.isArray(projectMembers)) {
        return [];
      }

      const normalizedMembers = Object.fromEntries(
        Object.entries(projectMembers).flatMap(([label, surface]) => {
          const normalizedSurface = typeof surface === "string" ? surface.trim() : "";
          return normalizedSurface ? [[label, normalizedSurface]] : [];
        }),
      );

      return Object.keys(normalizedMembers).length > 0 ? [[projectName, normalizedMembers]] : [];
    }),
  );
}

export function parseLiveSurfacesFromCmuxTree(output) {
  return Array.from(new Set(String(output ?? "").match(CMUX_TREE_SURFACE_PATTERN) ?? []));
}

function removeSurfacesFromRegistry(registry, surfacesToRemove) {
  const removeSet = new Set(
    Array.from(surfacesToRemove ?? [])
      .map((surface) => String(surface ?? "").trim())
      .filter(Boolean),
  );

  if (removeSet.size === 0) {
    return normalizeRegistry(registry);
  }

  return Object.fromEntries(
    Object.entries(normalizeRegistry(registry)).flatMap(([projectName, projectMembers]) => {
      const nextProjectMembers = Object.fromEntries(
        Object.entries(projectMembers).flatMap(([label, surface]) =>
          removeSet.has(surface)
            ? []
            : [[label, surface]],
        ),
      );

      return Object.keys(nextProjectMembers).length > 0 ? [[projectName, nextProjectMembers]] : [];
    }),
  );
}

export function reconcileRegistryWithCmuxTree(registry, cmuxTreeOutput) {
  const liveSurfaces = new Set(parseLiveSurfacesFromCmuxTree(cmuxTreeOutput));
  return Object.fromEntries(
    Object.entries(normalizeRegistry(registry)).flatMap(([projectName, projectMembers]) => {
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
  for (const member of getMembersById().values()) {
    const displayName = member?.name?.ko;
    if (typeof displayName !== "string" || !displayName.trim()) {
      continue;
    }

    members.set(displayName.trim(), {
      id: typeof member?.id === "string" ? member.id : "",
      emoji: typeof member?.emoji === "string" ? member.emoji : "",
      role: typeof member?.role?.ko === "string" ? member.role.ko : "",
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
 * @param {{ projects: Record<string, { members: Array<{ name: string, emoji: string, role: string, surface: string, status: TeamSurfaceStatus, lastOutput: string }> }> }} snapshot
 * @param {string} [updatedAt]
 * @returns {{ projects: Array<{ projectId: string, projectName: string, members: Array<{ id: string, state: "idle" | "working" | "error", lastOutputLines: string[], task: string | null, updatedAt: string | null }> }> }}
 */
export function toStudioTeamStatusSnapshot(snapshot, updatedAt = new Date().toISOString()) {
  const membersByName = createMembersByName();

  return {
    projects: Object.entries(snapshot?.projects ?? {}).map(([projectId, project]) => ({
      projectId,
      projectName: projectId,
      members: (project?.members ?? []).map((member) => {
        const memberMeta = membersByName.get(member.name);
        const { lastOutputLines } = classifySurfaceOutput(member.lastOutput);

        return {
          id: memberMeta?.id || member.surface,
          surface: member.surface || null,
          state: mapSurfaceStatusToStudioState(member.status),
          lastOutputLines,
          task: deriveTaskFromOutput(member.status, lastOutputLines),
          modelInfo: parseModelInfo(member.lastOutput),
          updatedAt,
        };
      }),
    })),
  };
}

export function filterTeamStatusSnapshot(snapshot, projectId) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!normalizedProjectId) {
    return cloneSnapshot(snapshot ?? { projects: {} });
  }

  const project = snapshot?.projects?.[normalizedProjectId];
  return {
    projects: project ? { [normalizedProjectId]: cloneSnapshot(project) } : {},
  };
}

async function defaultReadRegistry(registryPath) {
  const raw = await readFile(registryPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Registry root must be an object.");
  }
  return normalizeRegistry(/** @type {Record<string, Record<string, string>>} */ (parsed));
}

async function defaultWriteRegistry(registryPath, registry) {
  await writeFile(registryPath, `${JSON.stringify(normalizeRegistry(registry), null, 2)}\n`, "utf8");
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
      const rawRegistry = normalizeRegistry(await this.#readRegistry(this.#registryPath));
      const reconciledRegistry = await this.#reconcileRegistryAgainstCmuxTree(rawRegistry);
      this.#setRegistry(reconciledRegistry);
      await this.#seedImplicitSurfaceStates(this.#registry);

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
    this.#rawRegistry = normalizeRegistry(rawRegistry);
    this.#registry = withImplicitRegistryMembers(this.#rawRegistry);
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

  async #seedImplicitSurfaceStates(registry) {
    for (const member of IMPLICIT_REGISTRY_MEMBERS) {
      if (!hasRegistryMember(registry, member.name) || this.#surfaceStates.has(member.surface)) {
        continue;
      }

      const state = await this.#readSurfaceState(member.surface);
      this.#surfaceStates.set(member.surface, state);
    }
  }

  async #reconcileRegistryAgainstCmuxTree(rawRegistry) {
    const treeResult = await readCmuxTreeWithHealing(this.#readCmuxTree, {
      strictFirst: this.#preferStrictCmuxEnv,
    });
    if (treeResult.strictCmuxEnvUsed) {
      this.#preferStrictCmuxEnv = true;
    }

    if (!treeResult.ok) {
      return normalizeRegistry(rawRegistry);
    }

    const normalizedRegistry = normalizeRegistry(rawRegistry);
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
    const normalizedPrevious = normalizeRegistry(previousRegistry);
    const normalizedNext = normalizeRegistry(nextRegistry);
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
