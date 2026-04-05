import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

import { getMembersById } from "../team-metadata.mjs";

const DEFAULT_REGISTRY_PATH = "/tmp/kuma-surfaces.json";
const DEFAULT_REGISTRY_REFRESH_MS = 5_000;
const DEFAULT_SURFACE_POLL_MS = 10_000;
const SURFACE_READ_TIMEOUT_MS = 5_000;

/**
 * @typedef {"idle" | "working" | "dead"} TeamSurfaceStatus
 */

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

/**
 * @param {string} output
 * @returns {TeamSurfaceStatus}
 */
export function classifySurfaceStatus(output) {
  const normalized = String(output ?? "").replace(/\r/gu, "").trim();

  if (!normalized) {
    return "dead";
  }

  if (
    /invalid_params|not a terminal|no such surface|surface .* not found|read failed|timed out|enoent|command not found|fatal|panic|traceback|uncaught exception|segmentation fault/iu.test(normalized)
  ) {
    return "dead";
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines.at(-1) ?? "";

  if (/^(❯|›|>)\s*$/u.test(lastLine)) {
    return "idle";
  }

  if (
    /working|thinking|synthesizing|analyzing|processing|executing|running|searching|writing|editing|generating|planning|reviewing|patching|debugging|작업 중|생각 중|분석 중/iu.test(normalized)
  ) {
    return "working";
  }

  return "working";
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
      members: Object.entries(projectMembers)
        .filter(([, surface]) => typeof surface === "string" && surface.trim().length > 0)
        .map(([label, surface]) => {
          const { name, emoji: labelEmoji } = parseRegistryLabel(label);
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
      emoji: typeof member?.emoji === "string" ? member.emoji : "",
      role: typeof member?.role?.ko === "string" ? member.role.ko : "",
    });
  }
  return members;
}

async function defaultReadRegistry(registryPath) {
  const raw = await readFile(registryPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Registry root must be an object.");
  }
  return /** @type {Record<string, Record<string, string>>} */ (parsed);
}

async function defaultReadSurface(surface) {
  return new Promise((resolve) => {
    execFile(
      "cmux",
      ["read-screen", "--surface", surface, "--lines", "3"],
      {
        encoding: "utf8",
        timeout: SURFACE_READ_TIMEOUT_MS,
      },
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
  #readSurface;
  #membersByName = createMembersByName();
  #registry = {};
  #surfaceStates = new Map();
  #snapshot = { projects: {} };
  #listeners = new Set();
  #registryTimer = null;
  #surfaceTimer = null;
  #refreshingRegistry = false;
  #pollingSurfaces = false;

  /**
   * @param {{
   *   registryPath?: string,
   *   registryRefreshMs?: number,
   *   surfacePollMs?: number,
   *   readRegistryFn?: (registryPath: string) => Promise<Record<string, Record<string, string>>>,
   *   readSurfaceFn?: (surface: string) => Promise<{ ok: boolean, output: string }>,
   * }} [options]
   */
  constructor(options = {}) {
    this.#registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
    this.#registryRefreshMs = options.registryRefreshMs ?? DEFAULT_REGISTRY_REFRESH_MS;
    this.#surfacePollMs = options.surfacePollMs ?? DEFAULT_SURFACE_POLL_MS;
    this.#readRegistry = options.readRegistryFn ?? defaultReadRegistry;
    this.#readSurface = options.readSurfaceFn ?? defaultReadSurface;
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
      const registry = await this.#readRegistry(this.#registryPath);
      this.#registry = registry;

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
          try {
            const result = await this.#readSurface(surface);
            const output = String(result?.output ?? "").trim();
            return {
              surface,
              state: {
                status: result?.ok ? classifySurfaceStatus(output) : "dead",
                lastOutput: output,
              },
            };
          } catch (error) {
            return {
              surface,
              state: {
                status: "dead",
                lastOutput: error instanceof Error ? error.message : String(error),
              },
            };
          }
        }),
      );

      for (const { surface, state } of results) {
        this.#surfaceStates.set(surface, state);
      }

      this.#commitSnapshot(
        buildTeamStatusSnapshot(this.#registry, this.#surfaceStates, this.#membersByName),
        { notifyOnStructureChange: false },
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
          .flatMap((projectMembers) => Object.values(projectMembers ?? {}))
          .filter((surface) => typeof surface === "string" && surface.trim().length > 0),
      ),
    );
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
}
