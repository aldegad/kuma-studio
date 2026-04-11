import { buildTeamConfigSelfWriteHash } from "./team-config-hash.mjs";
import { getDefaultProjectIdForTeam } from "./project-defaults.mjs";

export function createTeamConfigWatcherHandler(options = {}) {
  const {
    teamConfigRuntime,
    studioWsEvents = null,
    workspaceRoot,
    appendLog = () => {},
  } = options;

  return async function handleTeamConfigChange({ changedIds, diff, previousMembers, currentMembers }) {
    appendLog(
      `TEAM_CONFIG_CHANGED: added=[${diff.added.join(",")}] removed=[${diff.removed.join(",")}] updated=[${diff.updated.join(",")}]`,
    );

    for (const memberId of diff.removed) {
      const previousMember = previousMembers[memberId];
      if (!previousMember) {
        continue;
      }

      try {
        teamConfigRuntime.removeMemberSurface({
          memberName: previousMember.name,
          emoji: previousMember.emoji,
        });
      } catch (error) {
        appendLog(
          `TEAM_CONFIG_REMOVE_ERROR: member=${previousMember.name} details=${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    const respawns = [];

    for (const memberId of [...diff.added, ...diff.updated]) {
      const currentMember = currentMembers[memberId];
      if (!currentMember) {
        continue;
      }

      const consumeResult = typeof teamConfigRuntime.consumePendingSelfWriteResult === "function"
        ? teamConfigRuntime.consumePendingSelfWriteResult({ memberId, memberConfig: currentMember })
        : {
            matched: teamConfigRuntime.consumePendingSelfWrite?.({ memberId, memberConfig: currentMember }) === true,
            reason: "legacy",
            currentHash: buildTeamConfigSelfWriteHash(currentMember),
            pendingHash: "",
          };
      if (consumeResult.matched) {
        appendLog(`TEAM_CONFIG_SELF_WRITE_SUPPRESSED: member=${currentMember.name} id=${memberId}`);
        continue;
      }
      if (consumeResult.reason === "hash-mismatch") {
        appendLog(
          `TEAM_CONFIG_SELF_WRITE_MISS: member=${currentMember.name} id=${memberId} expected=${consumeResult.pendingHash} actual=${consumeResult.currentHash}`,
        );
      }

      const memberContext = teamConfigRuntime.resolveMemberContext(currentMember.name, currentMember.emoji);
      const project = memberContext?.project ?? getDefaultProjectIdForTeam(currentMember.team, { workspaceRoot });

      try {
        const respawned = await teamConfigRuntime.respawnMember({
          memberName: currentMember.name,
          memberConfig: currentMember,
          project,
          currentSurface: memberContext?.surface ?? null,
          workspaceRoot,
        });

        respawns.push({
          member: currentMember.name,
          project: respawned.project,
          surface: respawned.surface ?? memberContext?.surface ?? null,
          queued: respawned.queued === true,
          cleanupFailed: respawned.cleanupFailed === true,
          cleanupError: respawned.cleanupError ?? null,
        });
      } catch (error) {
        appendLog(
          `TEAM_CONFIG_RESPAWN_ERROR: member=${currentMember.name} details=${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    studioWsEvents?.broadcastTeamConfigChanged({
      source: "watcher",
      changedIds,
      diff,
      respawns,
    });
  };
}
