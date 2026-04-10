import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";

import {
  readSurfaceRegistryFile,
  removeRegistryMemberSurface,
  resolveRegistryMemberContext,
  updateRegistryMemberSurface,
  writeSurfaceRegistryFile,
} from "../../../shared/surface-registry.mjs";
import { withCmuxEnv } from "../cmux-env.mjs";
import { buildTeamConfigSelfWriteHash } from "./team-config-hash.mjs";

const DEFAULT_SURFACE_REGISTRY_PATH = "/tmp/kuma-surfaces.json";
const DEFAULT_CMUX_SPAWN_SCRIPT = `${process.env.HOME ?? ""}/.kuma/cmux/kuma-cmux-spawn.sh`;
const DEFAULT_CMUX_KILL_SCRIPT = `${process.env.HOME ?? ""}/.kuma/cmux/kuma-cmux-kill.sh`;
const DEFAULT_TEAM_RESPAWN_QUEUE_PATH = "/tmp/kuma-team-respawn-queue.json";
const DEFAULT_TEAM_WATCHER_LOG_PATH = "/tmp/kuma-team-watcher.log";
const DEFAULT_TEAM_RESPAWN_QUEUE_POLL_MS = 5_000;

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

function resolveProjectId(project, memberConfig, memberContext) {
  if (typeof project === "string" && project.trim()) {
    return project.trim();
  }

  if (typeof memberContext?.project === "string" && memberContext.project) {
    return memberContext.project;
  }

  return memberConfig?.team === "system" ? "system" : "kuma-studio";
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
    selfWriteTtlMs = 3_000,
    now = () => Date.now(),
    spawnRunner = defaultSpawnRunner,
    killRunner = defaultKillRunner,
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
  const performRespawn = ({ memberName, memberConfig, project, currentSurface, workspaceRoot }) => {
    const spawnArgs = [
      `${memberConfig?.emoji ? `${memberConfig.emoji} ` : ""}${memberName}`.trim(),
      memberConfig?.type ?? "",
      workspaceRoot,
      project,
    ];

    if (currentSurface) {
      const workspace = resolveWorkspaceForSurfaceFn(currentSurface);
      const pane = resolvePaneForSurfaceFn(currentSurface);
      if (workspace) {
        spawnArgs.push("--workspace", workspace);
      }
      if (pane) {
        spawnArgs.push("--pane", pane);
      }
    }

    const spawnResult = spawnRunner(spawnScriptPath, spawnArgs);
    if (spawnResult?.error) {
      throw spawnResult.error;
    }
    const output = String(spawnResult?.stdout ?? "").trim();
    const stderr = String(spawnResult?.stderr ?? "").trim();
    if (stderr) {
      for (const line of stderr.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)) {
        logEvent(line);
      }
    }
    if (spawnResult?.status !== 0) {
      throw new Error(`Failed to respawn ${memberName}: ${stderr || output || "spawn failed"}`);
    }
    const nextSurface = output.match(/surface:\d+/u)?.[0] ?? output;
    if (!/^surface:\d+$/u.test(nextSurface)) {
      throw new Error(`Failed to respawn ${memberName}: ${output || "missing surface id"}`);
    }

    let cleanupFailed = false;
    let cleanupError = null;
    if (currentSurface) {
      try {
        killRunner(killScriptPath, currentSurface);
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error instanceof Error ? error.message : "unknown error";
        logEvent(
          `RESPAWN_CLEANUP_FAILED: member=${memberName} surface=${currentSurface} details=${cleanupError}`,
        );
      }
    }

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
    resolveMemberContext(memberName, emoji) {
      return resolveRegistryMemberContext(
        readSurfaceRegistryFile(registryPath),
        {
          displayName: memberName,
          emoji,
        },
      );
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

      if (memberContext?.surface) {
        try {
          killRunner(killScriptPath, memberContext.surface);
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
      const memberContext = runtime.resolveMemberContext(memberName, memberConfig?.emoji);
      const nextProject = resolveProjectId(project, memberConfig, memberContext);
      const nextCurrentSurface = currentSurface ?? memberContext?.surface ?? null;
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
