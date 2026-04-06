import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

import { getMembersById } from "../team-metadata.mjs";

const DEFAULT_REGISTRY_PATH = "/tmp/kuma-surfaces.json";
const DEFAULT_REGISTRY_REFRESH_MS = 5_000;
const DEFAULT_SURFACE_POLL_MS = 10_000;
const SURFACE_READ_TIMEOUT_MS = 5_000;
const PROMPT_LINE_PATTERN = /^(❯|>)\s*$|^›/u;
const BOX_DRAWING_PATTERN = /[\u2500-\u257F]/u;
const WORKING_SURFACE_PATTERNS = [
  /^[✻✶✳✢·]\s*(?:concocting|meandering|fiddle-faddling|saut(?:e|é)ed|churned|cooked|baked|brewed|metamorphosing|working)\b/iu,
  /\brunning(?:\.\.\.|…)/iu,
];
const SURFACE_HINT_PATTERNS = [
  /^bypass permissions\b/iu,
  /^(?:brewed|baked) for\b/iu,
  /^gpt-[\w.-]+\s+(?:low|medium|high|xhigh)(?:\s+fast)?\b/iu,
  /^esc to\b/iu,
  /^press up to edit\b/iu,
  /^shift\+tab to cycle\b/iu,
  /^tab to queue\b/iu,
  /^[─━═─]{3,}$/u,
];

/**
 * @typedef {"idle" | "working" | "dead"} TeamSurfaceStatus
 */

const STUDIO_MEMBER_STATE_BY_SURFACE_STATUS = {
  idle: "idle",
  working: "working",
  dead: "error",
};

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

  const lines = getOutputLines(normalized);
  if (hasWorkingSurfaceSignal(lines)) {
    return "working";
  }

  const promptVisible = lines.some((line) => {
    if (PROMPT_LINE_PATTERN.test(line)) {
      return true;
    }

    const withoutBoxDrawing = line.replace(/[\u2500-\u257F]/gu, "").trim();
    return PROMPT_LINE_PATTERN.test(withoutBoxDrawing);
  });

  if (promptVisible) {
    return "idle";
  }

  const meaningfulLines = getMeaningfulOutputLines(normalized);

  if (meaningfulLines.length === 0) {
    return "idle";
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

function getOutputLines(output) {
  return String(output ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasWorkingSurfaceSignal(lines) {
  return lines.some((line) => WORKING_SURFACE_PATTERNS.some((pattern) => pattern.test(line)));
}

function isIgnoredSurfaceLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    return false;
  }

  if (BOX_DRAWING_PATTERN.test(trimmed)) {
    return true;
  }

  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  const normalized = trimmed.replace(/^[^\p{L}\p{N}]+/u, "");
  return SURFACE_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getMeaningfulOutputLines(output) {
  return getOutputLines(output).filter(
    (line) => !PROMPT_LINE_PATTERN.test(line) && !isIgnoredSurfaceLine(line),
  );
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

function getLastOutputLines(output) {
  const meaningfulLines = getMeaningfulOutputLines(output);
  if (meaningfulLines.length > 0) {
    return meaningfulLines.slice(-3);
  }

  const promptLines = getOutputLines(output).filter((line) => PROMPT_LINE_PATTERN.test(line));
  return promptLines.slice(-1);
}

function deriveTaskFromOutput(status, lastOutputLines) {
  if (status !== "working") {
    return null;
  }

  const taskLine = [...lastOutputLines]
    .reverse()
    .find((line) => !PROMPT_LINE_PATTERN.test(line) && !isIgnoredSurfaceLine(line));

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
    const codexMatch = line.match(/(gpt-[\w.-]+)\s+(low|medium|high|xhigh)(?:\s+(fast))?/iu);
    if (codexMatch) {
      model = codexMatch[1].toLowerCase();
      effort = codexMatch[2].toLowerCase();
      speed = codexMatch[3]?.toLowerCase() ?? null;
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
        const lastOutputLines = getLastOutputLines(member.lastOutput);

        return {
          id: memberMeta?.id || member.surface,
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
  return /** @type {Record<string, Record<string, string>>} */ (parsed);
}

async function defaultReadSurface(surface) {
  return new Promise((resolve) => {
    execFile(
      "cmux",
      ["read-screen", "--surface", surface, "--lines", "10"],
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
          .flatMap((projectMembers) => getRegistryProjectMembers(projectMembers))
          .map(({ surface }) => surface),
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
