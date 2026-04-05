import { useEffect } from "react";
import { fetchJobCards } from "../lib/api";
import { useWsStore } from "../stores/use-ws-store";
import { useDashboardStore } from "../stores/use-dashboard-store";
import { useOfficeStore } from "../stores/use-office-store";
import { useTeamStatusStore, type TeamMemberStatus } from "../stores/use-team-status-store";
import type { JobCard } from "../types/job-card";

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

interface TeamStatusUpdateEvent {
  type: "kuma-studio:team-status-update";
  snapshot?: { projects: import("../stores/use-team-status-store").ProjectTeamStatus[] };
  member?: TeamMemberStatus;
  members?: TeamMemberStatus[];
}

export function useWebSocket() {
  const { connect, ws, status } = useWsStore();
  const { upsertJob, setJobs, setStats, addTokenUsage, setGitActivity } = useDashboardStore();
  const { updateCharacterState, applyLayout } = useOfficeStore();
  const { setProjects, updateMemberStatus, batchUpdateMembers } = useTeamStatusStore();

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

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data: StudioEvent = JSON.parse(event.data);
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

    const handleTeamStatusMessage = (event: MessageEvent) => {
      try {
        const data: TeamStatusUpdateEvent = JSON.parse(event.data as string);
        if (data.type !== "kuma-studio:team-status-update") return;

        if (data.snapshot?.projects) {
          setProjects(data.snapshot.projects);
        }
        if (data.member) {
          updateMemberStatus(data.member);
        }
        if (data.members) {
          batchUpdateMembers(data.members);
        }
      } catch {
        // ignore
      }
    };

    ws.addEventListener("message", handleMessage);
    ws.addEventListener("message", handleTeamStatusMessage);
    return () => {
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("message", handleTeamStatusMessage);
    };
  }, [ws, upsertJob, setStats, addTokenUsage, setGitActivity, updateCharacterState, applyLayout, setProjects, updateMemberStatus, batchUpdateMembers]);

  return { status };
}
