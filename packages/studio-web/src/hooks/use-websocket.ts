import { useEffect } from "react";
import { fetchJobCards, fetchTeamStatus } from "../lib/api";
import { useWsStore } from "../stores/use-ws-store";
import { useDashboardStore } from "../stores/use-dashboard-store";
import { useOfficeStore } from "../stores/use-office-store";
import { useTeamConfigStore } from "../stores/use-team-config-store";
import { getAutoPosition } from "../lib/office-scene";
import {
  extractTeamStatusSnapshotFromWsMessage,
  useTeamStatusStore,
  type TeamStatusSnapshot,
} from "../stores/use-team-status-store";
import type { AgentState } from "../types/agent";
import type { JobCard } from "../types/job-card";
import type { PlansSnapshot } from "../types/plan";

interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: import("../types/job-card").JobCard }
    | { kind: "agent-state-change"; agentId: string; state: import("../types/agent").AgentState; task?: string | null }
    | { kind: "token-usage"; agentId: string; tokens: number; model: string }
    | { kind: "stats-snapshot"; stats: import("../types/stats").DashboardStats }
    | { kind: "git-activity-update"; activity: import("../types/stats").GitActivitySnapshot }
    | { kind: "office-layout-update"; layout: import("../types/office").OfficeLayoutSnapshot };
}

interface PlansUpdateEvent {
  type: "kuma-studio:plans-update";
  snapshot: PlansSnapshot;
}

/** Sync team-status snapshot → office character states */
function syncTeamStatusToOffice(snapshot: TeamStatusSnapshot) {
  const { scene, updateCharacterState, draggedIds, activeLayout } = useOfficeStore.getState();
  const characterMap = new Map(
    scene.characters.map((c) => [c.id, c] as const),
  );

  for (const project of snapshot.projects) {
    for (const member of project.members) {
      const current = characterMap.get(member.id);
      if (!current) continue;

      const stateChanged = current.state !== member.state || current.task !== member.task;
      const hasDragFlag = draggedIds.has(member.id);

      // Also detect position mismatch: idle characters stuck at desk on page load.
      // getAutoPosition is deterministic so this is cheap to compute.
      let positionMismatch = false;
      if (!stateChanged && !hasDragFlag) {
        const expected = getAutoPosition(
          member.id,
          member.state as AgentState,
          current.team,
          activeLayout.deskPositions,
          activeLayout.sofaPositions,
          activeLayout.teamMemberIdsByTeam,
        );
        if (expected && (current.position.x !== expected.x || current.position.y !== expected.y)) {
          positionMismatch = true;
        }
      }

      if (stateChanged || hasDragFlag || positionMismatch) {
        updateCharacterState(member.id, member.state as AgentState, member.task);
      }
    }
  }
}

export function useWebSocket() {
  const { connect, ws, status } = useWsStore();
  const { upsertJob, setJobs, setStats, addTokenUsage, setGitActivity, setPlans } = useDashboardStore();
  const { updateCharacterState, applyLayout, syncCharactersFromTeam } = useOfficeStore();
  const { setProjects } = useTeamStatusStore();
  const fetchTeamConfigFromStore = useTeamConfigStore((s) => s.fetch);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const jobs = await fetchJobCards();
        if (!cancelled && Array.isArray(jobs)) {
          setJobs(jobs as JobCard[]);
        }
      } catch {
        // Live updates over websocket will still populate the feed.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setJobs]);

  // Initial team-status fetch → sync to office characters
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await fetchTeamStatus();
        if (cancelled) return;
        setProjects(snapshot.projects);
        syncTeamStatusToOffice(snapshot);
      } catch {
        // WebSocket updates will still arrive.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setProjects]);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const payload: unknown = JSON.parse(event.data);
        const teamStatusSnapshot = extractTeamStatusSnapshotFromWsMessage(payload);
        if (teamStatusSnapshot) {
          setProjects(teamStatusSnapshot.projects);
          syncTeamStatusToOffice(teamStatusSnapshot);
          return;
        }

        if ((payload as { type?: string }).type === "kuma-studio:team-config-changed") {
          void (async () => {
            try {
              const agents = await fetchTeamConfigFromStore();
              syncCharactersFromTeam(agents);
            } catch {
              // Leave the existing team config in place if refresh fails.
            }
          })();
          return;
        }

        const data = payload as StudioEvent;
        if ((payload as PlansUpdateEvent).type === "kuma-studio:plans-update") {
          setPlans((payload as PlansUpdateEvent).snapshot);
          return;
        }

        if (data.type !== "kuma-studio:event") return;

        const evt = data.event;
        switch (evt.kind) {
          case "job-card-update":
            upsertJob(evt.card);
            break;
          case "agent-state-change":
            updateCharacterState(evt.agentId, evt.state, evt.task);
            break;
          case "token-usage":
            addTokenUsage({
              agentId: evt.agentId,
              model: evt.model,
              tokens: evt.tokens,
              recordedAt: new Date().toISOString(),
            });
            break;
          case "stats-snapshot":
            setStats(evt.stats);
            break;
          case "git-activity-update":
            setGitActivity(evt.activity);
            break;
          case "office-layout-update":
            applyLayout(evt.layout);
            break;
        }
      } catch {
        // ignore non-JSON or unknown messages
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => {
      ws.removeEventListener("message", handleMessage);
    };
  }, [ws, upsertJob, setStats, addTokenUsage, setGitActivity, setPlans, updateCharacterState, applyLayout, setProjects, fetchTeamConfigFromStore, syncCharactersFromTeam]);

  return { status };
}
