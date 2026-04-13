import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";

import {
  buildRegistryLabel,
  parseRegistryLabel,
  readSurfaceRegistryFile,
  removeRegistryMemberSurface,
  resolveRegistryMemberContext,
  updateRegistryMemberSurface,
  writeSurfaceRegistryFile,
} from "../../../shared/surface-registry.mjs";
import { withCmuxEnv } from "../cmux-env.mjs";
import { getDefaultProjectIdForTeam } from "./project-defaults.mjs";
import { buildTeamConfigSelfWriteHash } from "./team-config-hash.mjs";

const DEFAULT_SURFACE_REGISTRY_PATH = "/tmp/kuma-surfaces.json";
const DEFAULT_CMUX_SPAWN_SCRIPT = `${process.env.HOME ?? ""}/.kuma/cmux/kuma-cmux-spawn.sh`;
const DEFAULT_CMUX_KILL_SCRIPT = `${process.env.HOME ?? ""}/.kuma/cmux/kuma-cmux-kill.sh`;
const DEFAULT_TEAM_RESPAWN_QUEUE_PATH = "/tmp/kuma-team-respawn-queue.json";
const DEFAULT_TEAM_WATCHER_LOG_PATH = "/tmp/kuma-team-watcher.log";
const DEFAULT_TEAM_RESPAWN_QUEUE_POLL_MS = 5_000;
const SURFACE_NOT_FOUND_PATTERN = /(?:\bno such surface\b|\bsurface(?::\d+|\s+[^\n\r]+)?\s+not found\b)/iu;
const CMUX_TREE_SURFACE_LINE_PATTERN = /surface\s+(surface:\d+)\s+\[[^\]]+\](?:\s+"([^"]*)")?/u;

function titleMatchesMember(title, memberName, emoji = "") {
  const normalizedTitle = String(title ?? "").trim();
  const normalizedMemberName = String(memberName ?? "").trim();
  const normalizedEmoji = String(emoji ?? "").trim();

  if (!normalizedTitle || !normalizedMemberName) {
    return false;
  }

  const parsed = parseRegistryLabel(normalizedTitle);
  const canonicalLabel = buildRegistryLabel(normalizedMemberName, normalizedEmoji);

  return (
    normalizedTitle === normalizedMemberName
    || normalizedTitle === canonicalLabel
    || parsed.name === normalizedMemberName
    || (normalizedEmoji && parsed.emoji === normalizedEmoji && parsed.name === normalizedMemberName)
  );
}

function readLiveMemberSurfacesFromCmux(memberName, emoji = "") {
  try {
    const output = String(execSync("cmux tree 2>&1", withCmuxEnv({ encoding: "utf8" })));
    const surfaces = [];

    for (const line of output.split(/\r?\n/u)) {
      const match = line.match(CMUX_TREE_SURFACE_LINE_PATTERN);
      if (!match) {
        continue;
      }

      const [, surface, title = ""] = match;
      if (!titleMatchesMember(title, memberName, emoji)) {
        continue;
      }

      surfaces.push(surface);
    }

    return Array.from(new Set(surfaces));
  } catch {
    return [];
  }
}

function resolveWorkspaceForSurface(surface) {
  if (!/^surface:\d+$/u.test(surface)) {
    return null;
  }

  try {
    const escaped = surface.replace(/'/gu, "'\\''");
    const output = String(execSync(
      `cmux tree 2>&1 | awk -v target='${escaped}' '{ if (match($0, /workspace:[0-9]+/)) { current_ws = substr($0, RSTART, RLENGTH) } if (index($0, target) > 0) { print current_ws; exit } }'`,
      withCmuxEnv({ encoding: "utf8" }),
    )).trim();

    return output || null;
  } catch {
    return null;
  }
}

function resolvePaneForSurface(surface) {
  if (!/^surface:\d+$/u.test(surface)) {
    return null;
  }

  try {
    const escaped = surface.replace(/'/gu, "'\\''");
    const output = String(execSync(
      `cmux tree 2>&1 | grep -B5 '${escaped}' | grep -oE 'pane:[0-9]+' | tail -1`,
      withCmuxEnv({ encoding: "utf8" }),
    )).trim();

    return output || null;
  } catch {
    return null;
  }
}

export function findMemberStatus(snapshot, memberName) {
  for (const project of Object.values(snapshot?.projects ?? {})) {
    for (const member of project?.members ?? []) {
      if (member?.name === memberName) {
        return member.status ?? null;
      }
    }
  }

  return null;
}

function readRespawnQueue(queuePath) {
  try {
    const parsed = JSON.parse(readFileSync(queuePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeRespawnQueue(queuePath, queue) {
  mkdirSync(dirname(queuePath), { recursive: true });
  writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
}

function appendTeamWatcherLog(logPath, message) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function resolveProjectId(project, memberConfig, memberContext, workspaceRoot) {
  if (typeof project === "string" && project.trim()) {
    return project.trim();
  }

  if (typeof memberContext?.project === "string" && memberContext.project) {
    return memberContext.project;
  }

  return getDefaultProjectIdForTeam(memberConfig?.team, { workspaceRoot });
}

function defaultSpawnRunner(scriptPath, args) {
  const result = spawnSync(
    scriptPath,
    args,
    withCmuxEnv({
      encoding: "utf8",
      env: {
        ...process.env,
        KUMA_SKIP_AGENT_STATE_NOTIFY: "1",
      },
    }),
  );

  return {
    status: result.status ?? 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    error: result.error ?? null,
  };
}

function defaultKillRunner(scriptPath, surface) {
  execFileSync(scriptPath, [surface], withCmuxEnv({ encoding: "utf8" }));
}

function isMissingSurfaceError(error) {
  if (error instanceof Error) {
    return SURFACE_NOT_FOUND_PATTERN.test(error.message);
  }

  return false;
}

function resolveCanonicalContextProject(requestedProject, team) {
  const normalizedRequestedProject = typeof requestedProject === "string" ? requestedProject.trim() : "";
  const normalizedTeam = typeof team === "string" ? team.trim() : "";

  if (normalizedTeam === "system") {
    return "system";
  }

  return normalizedRequestedProject || normalizedTeam || null;
}

export function createTeamConfigRuntime(options = {}) {
  const {
    teamStatusStore = null,
    teamConfigStore = null,
    registryPath = DEFAULT_SURFACE_REGISTRY_PATH,
    spawnScriptPath = DEFAULT_CMUX_SPAWN_SCRIPT,
    killScriptPath = DEFAULT_CMUX_KILL_SCRIPT,
    queuePath = DEFAULT_TEAM_RESPAWN_QUEUE_PATH,
    logPath = DEFAULT_TEAM_WATCHER_LOG_PATH,
    queuePollMs = DEFAULT_TEAM_RESPAWN_QUEUE_POLL_MS,
    selfWriteTtlMs = 30_000,
    now = () => Date.now(),
    spawnRunner = defaultSpawnRunner,
    killRunner = defaultKillRunner,
    resolveLiveMemberSurfacesFn = readLiveMemberSurfacesFromCmux,
    resolveWorkspaceForSurfaceFn = resolveWorkspaceForSurface,
    resolvePaneForSurfaceFn = resolvePaneForSurface,
  } = options;
  let queue = readRespawnQueue(queuePath);
  let queueTimer = null;
  const pendingSelfWrites = new Map();

  const persistQueue = () => {
    writeRespawnQueue(queuePath, queue);
  };
  const removeQueuedRespawn = (memberId) => {
    if (!memberId || !queue[memberId]) {
      return;
    }

    delete queue[memberId];
    persistQueue();
  };
  const pruneExpiredSelfWrites = () => {
    const timestamp = now();
    for (const [memberId, entry] of pendingSelfWrites.entries()) {
      if (entry.inFlight === true) {
        continue;
      }

      if (entry.expiresAt <= timestamp) {
        pendingSelfWrites.delete(memberId);
      }
    }
  };
  const getMemberStatus = (memberName) => findMemberStatus(teamStatusStore?.getSnapshot() ?? { projects: {} }, memberName);
  const logEvent = (message) => appendTeamWatcherLog(logPath, message);
  const performRespawn = ({ memberName, memberConfig, project, currentSurface, cleanupSurfaces, workspaceRoot }) => {
    let cleanupFailed = false;
    let cleanupError = null;
    const normalizedCleanupSurfaces = Array.from(
      new Set(
        [
          currentSurface,
          ...(Array.isArray(cleanupSurfaces) ? cleanupSurfaces : []),
        ].filter((surface) => /^surface:\d+$/u.test(surface ?? "")),
      ),
    );
    const primarySurface = normalizedCleanupSurfaces[0] ?? null;

    // Capture workspace/pane BEFORE kill — the surface must be alive to resolve these.
    const workspace = primarySurface ? resolveWorkspaceForSurfaceFn(primarySurface) : null;
    const pane = primarySurface ? resolvePaneForSurfaceFn(primarySurface) : null;

    if (normalizedCleanupSurfaces.length > 0) {
      for (const surface of normalizedCleanupSurfaces) {
        try {
          killRunner(killScriptPath, surface);
        } catch (error) {
          if (!isMissingSurfaceError(error)) {
            cleanupFailed = true;
            cleanupError = error instanceof Error ? error.message : "unknown error";
            logEvent(
              `RESPAWN_CLEANUP_FAILED: member=${memberName} surface=${surface} details=${cleanupError}`,
            );
            throw error;
          }
        }
      }

      const registryWithoutCurrent = removeRegistryMemberSurface(
        readSurfaceRegistryFile(registryPath),
        memberName,
        memberConfig?.emoji ?? "",
      );
      writeSurfaceRegistryFile(registryPath, registryWithoutCurrent);
    }

    const memberId = memberConfig?.id ?? memberName;
    const baseSpawnArgs = [
      `${memberConfig?.emoji ? `${memberConfig.emoji} ` : ""}${memberName}`.trim(),
      memberConfig?.type ?? "",
      workspaceRoot,
      project,
    ];

    const runSpawn = (extraArgs) => {
      const result = spawnRunner(spawnScriptPath, [...baseSpawnArgs, ...extraArgs]);
      const stdout = String(result?.stdout ?? "").trim();
      const stderr = String(result?.stderr ?? "").trim();
      if (stderr) {
        for (const line of stderr.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)) {
          logEvent(line);
        }
      }
      const failed = result?.error != null || result?.status !== 0;
      const nextSurface = stdout.match(/surface:\d+/u)?.[0] ?? "";
      return { failed, error: result?.error ?? null, stdout, stderr, nextSurface };
    };

    const locationArgs = [];
    if (primarySurface) {
      if (workspace) locationArgs.push("--workspace", workspace);
      if (pane) locationArgs.push("--pane", pane);
    }

    let attempt = runSpawn(locationArgs);
    // If the placed spawn fails (stale workspace/pane after kill collapsed it), retry fresh.
    if (attempt.failed && locationArgs.length > 0) {
      logEvent(
        `RESPAWN_FALLBACK: member=${memberName} reason=retry-without-location prev=${attempt.stderr || attempt.stdout || attempt.error?.message || "unknown"}`,
      );
      attempt = runSpawn([]);
    }

    if (attempt.failed || !/^surface:\d+$/u.test(attempt.nextSurface)) {
      // Old surface is dead and spawn failed. Queue for background retry
      // (fresh spawn, no location) so the member isn't permanently orphaned.
      queue[memberId] = {
        memberId,
        memberName,
        project,
        currentSurface: null,
        requestedAt: new Date().toISOString(),
        workspaceRoot,
      };
      persistQueue();
      logEvent(
        `RESPAWN_QUEUED_AFTER_FAILURE: member=${memberName} reason=spawn-failed details=${attempt.stderr || attempt.stdout || attempt.error?.message || "unknown"}`,
      );
      if (attempt.error) throw attempt.error;
      throw new Error(`Failed to respawn ${memberName}: ${attempt.stderr || attempt.stdout || "spawn failed"}`);
    }

    const nextSurface = attempt.nextSurface;

    const nextRegistry = updateRegistryMemberSurface(
      readSurfaceRegistryFile(registryPath),
      {
        projectId: project,
        memberName,
        emoji: memberConfig?.emoji ?? "",
        surface: nextSurface,
      },
    );
    writeSurfaceRegistryFile(registryPath, nextRegistry);

    return {
      project,
      surface: nextSurface,
      cleanupFailed,
      cleanupError,
    };
  };

  const runtime = {
    resolveLiveMemberSurfaces(memberName, emoji = "") {
      return resolveLiveMemberSurfacesFn(memberName, emoji);
    },
    resolveMemberContext(memberName, emoji, requestedProject = "", team = "") {
      const canonicalProject = resolveCanonicalContextProject(requestedProject, team);
      const canonicalLabel = buildRegistryLabel(memberName, emoji) || String(memberName ?? "").trim();
      const registryContext = resolveRegistryMemberContext(
        readSurfaceRegistryFile(registryPath),
        {
          displayName: memberName,
          emoji,
          team,
        },
        requestedProject,
      );

      if (registryContext) {
        if (canonicalProject && registryContext.project !== canonicalProject) {
          const nextRegistry = updateRegistryMemberSurface(
            readSurfaceRegistryFile(registryPath),
            {
              projectId: canonicalProject,
              memberName,
              emoji,
              surface: registryContext.surface,
            },
          );
          writeSurfaceRegistryFile(registryPath, nextRegistry);
          return {
            project: canonicalProject,
            label: canonicalLabel,
            surface: registryContext.surface,
          };
        }

        return registryContext;
      }

      const liveSurfaces = runtime.resolveLiveMemberSurfaces(memberName, emoji);
      const liveSurface = liveSurfaces[0] ?? null;
      if (!liveSurface) {
        return null;
      }

      if (canonicalProject) {
        const nextRegistry = updateRegistryMemberSurface(
          readSurfaceRegistryFile(registryPath),
          {
            projectId: canonicalProject,
            memberName,
            emoji,
            surface: liveSurface,
          },
        );
        writeSurfaceRegistryFile(registryPath, nextRegistry);
      }

      return {
        project: canonicalProject,
        label: canonicalLabel,
        surface: liveSurface,
      };
    },
    registerPendingSelfWrite({ memberId, memberConfig, ttlMs = selfWriteTtlMs }) {
      if (!memberId) {
        return;
      }

      pruneExpiredSelfWrites();
      pendingSelfWrites.set(memberId, {
        hash: buildTeamConfigSelfWriteHash(memberConfig),
        expiresAt: now() + ttlMs,
        inFlight: true,
      });
    },
    settlePendingSelfWrite(memberId, ttlMs = selfWriteTtlMs) {
      if (!memberId) {
        return;
      }

      pruneExpiredSelfWrites();
      const entry = pendingSelfWrites.get(memberId);
      if (!entry) {
        return;
      }

      pendingSelfWrites.set(memberId, {
        ...entry,
        expiresAt: now() + ttlMs,
        inFlight: false,
      });
    },
    consumePendingSelfWriteResult({ memberId, memberConfig }) {
      const currentHash = buildTeamConfigSelfWriteHash(memberConfig);
      if (!memberId) {
        return {
          matched: false,
          reason: "missing-member-id",
          currentHash,
          pendingHash: "",
        };
      }

      pruneExpiredSelfWrites();
      const entry = pendingSelfWrites.get(memberId);
      if (!entry) {
        return {
          matched: false,
          reason: "missing-entry",
          currentHash,
          pendingHash: "",
        };
      }

      if (entry.hash !== currentHash) {
        pendingSelfWrites.delete(memberId);
        return {
          matched: false,
          reason: "hash-mismatch",
          currentHash,
          pendingHash: entry.hash,
        };
      }

      pendingSelfWrites.delete(memberId);
      return {
        matched: true,
        reason: "matched",
        currentHash,
        pendingHash: entry.hash,
      };
    },
    consumePendingSelfWrite(input) {
      return runtime.consumePendingSelfWriteResult(input).matched;
    },
    clearPendingSelfWrite(memberId) {
      if (!memberId) {
        return;
      }

      pendingSelfWrites.delete(memberId);
    },
    removeMemberSurface({ memberName, emoji = "", currentSurface = null }) {
      const memberContext = currentSurface
        ? { surface: currentSurface, project: null }
        : runtime.resolveMemberContext(memberName, emoji);
      const nextRegistry = removeRegistryMemberSurface(readSurfaceRegistryFile(registryPath), memberName, emoji);
      writeSurfaceRegistryFile(registryPath, nextRegistry);

      for (const surface of Array.from(new Set([
        memberContext?.surface ?? null,
        ...runtime.resolveLiveMemberSurfaces(memberName, emoji),
      ].filter(Boolean)))) {
        try {
          killRunner(killScriptPath, surface);
        } catch {
          // If the surface is already gone we still want the registry cleanup to stick.
        }
      }

      logEvent(`SURFACE_REMOVED: member=${memberName} surface=${memberContext?.surface ?? "none"}`);
      return {
        project: memberContext?.project ?? null,
        surface: memberContext?.surface ?? null,
        removed: true,
      };
    },
    respawnMember({ memberName, memberConfig, project, currentSurface, workspaceRoot, deferIfWorking = true }) {
      const memberContext = runtime.resolveMemberContext(
        memberName,
        memberConfig?.emoji,
        project,
        memberConfig?.team,
      );
      const nextProject = resolveProjectId(project, memberConfig, memberContext, workspaceRoot);
      const liveSurfaces = runtime.resolveLiveMemberSurfaces(memberName, memberConfig?.emoji);
      const nextCurrentSurface = currentSurface ?? memberContext?.surface ?? liveSurfaces[0] ?? null;
      const cleanupSurfaces = Array.from(new Set([
        nextCurrentSurface,
        ...liveSurfaces,
      ].filter(Boolean)));
      const memberStatus = getMemberStatus(memberName);
      const memberId = memberConfig?.id ?? memberName;

      if (deferIfWorking && memberStatus === "working") {
        queue[memberId] = {
          memberId,
          memberName,
          project: nextProject,
          currentSurface: nextCurrentSurface,
          requestedAt: new Date().toISOString(),
          workspaceRoot,
        };
        persistQueue();
        logEvent(`RESPAWN_QUEUED: member=${memberName} surface=${nextCurrentSurface ?? "none"} status=working`);
        return {
          project: nextProject,
          surface: nextCurrentSurface,
          queued: true,
        };
      }

      const result = performRespawn({
        memberName,
        memberConfig,
        project: nextProject,
        currentSurface: nextCurrentSurface,
        cleanupSurfaces,
        workspaceRoot,
      });
      removeQueuedRespawn(memberId);
      logEvent(
        `RESPAWN_APPLIED: member=${memberName} old=${nextCurrentSurface ?? "none"} new=${result.surface} cleanupFailed=${result.cleanupFailed === true}`,
      );
      return {
        ...result,
        queued: false,
      };
    },
    processRespawnQueue() {
      for (const [memberId, entry] of Object.entries(queue)) {
        const latestEntry = teamConfigStore?.getMember(memberId) ?? teamConfigStore?.getMember(entry.memberName);
        if (!latestEntry) {
          removeQueuedRespawn(memberId);
          logEvent(`RESPAWN_DROPPED: member=${entry.memberName} reason=missing-member`);
          continue;
        }

        const status = getMemberStatus(latestEntry.key);
        if (status === "working") {
          continue;
        }

        try {
          const currentContext = runtime.resolveMemberContext(latestEntry.key, latestEntry.member.emoji);
          runtime.respawnMember({
            memberName: latestEntry.key,
            memberConfig: latestEntry.member,
            project: entry.project,
            currentSurface: currentContext?.surface ?? entry.currentSurface ?? null,
            workspaceRoot: entry.workspaceRoot,
            deferIfWorking: false,
          });
        } catch (error) {
          logEvent(
            `RESPAWN_ERROR: member=${latestEntry.key} details=${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      }
    },
    close() {
      if (queueTimer != null) {
        clearInterval(queueTimer);
      }
    },
  };

  if (queuePollMs > 0) {
    queueTimer = setInterval(() => {
      runtime.processRespawnQueue();
    }, queuePollMs);
    queueTimer.unref?.();
  }

  return runtime;
}
