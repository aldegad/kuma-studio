import { useEffect, useRef } from "react";
import { fetchJobCards, fetchTeamStatus } from "../lib/api";
import { useWsStore } from "../stores/use-ws-store";
import { useDashboardStore } from "../stores/use-dashboard-store";
import { useOfficeStore } from "../stores/use-office-store";
import { useTeamConfigStore } from "../stores/use-team-config-store";
import { useDispatchVisualStore } from "../stores/use-dispatch-visual-store";
import { getAutoPosition } from "../lib/office-scene";
import {
  extractTeamStatusSnapshotFromWsMessage,
  useTeamStatusStore,
  type TeamStatusSnapshot,
  type TeamMemberStatus,
} from "../stores/use-team-status-store";
import type { Agent, AgentState } from "../types/agent";
import type { JobCard } from "../types/job-card";
import type { PlansSnapshot } from "../types/plan";

interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: import("../types/job-card").JobCard }
    | { kind: "agent-state-change"; agentId: string; state: import("../types/agent").AgentState; task?: string | null }
    | { kind: "dispatch-update"; dispatch: DispatchRecordPayload }
    | { kind: "token-usage"; agentId: string; tokens: number; model: string }
    | { kind: "stats-snapshot"; stats: import("../types/stats").DashboardStats }
    | { kind: "git-activity-update"; activity: import("../types/stats").GitActivitySnapshot }
    | { kind: "office-layout-update"; layout: import("../types/office").OfficeLayoutSnapshot };
}

interface PlansUpdateEvent {
  type: "kuma-studio:plans-update";
  snapshot: PlansSnapshot;
}

type DispatchMessageKind = "instruction" | "question" | "answer" | "status" | "note" | "blocker";

interface DispatchMessagePayload {
  id: string;
  kind: DispatchMessageKind;
  text: string;
  from: string;
  to: string;
  fromSurface: string;
  toSurface: string;
}

interface DispatchRecordPayload {
  taskId: string;
  initiator?: string;
  worker?: string;
  workerId?: string;
  workerName?: string;
  qa?: string;
  qaMember?: string;
  qaSurface?: string;
  messages?: DispatchMessagePayload[];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDispatchMessage(value: unknown): DispatchMessagePayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const kind = normalizeString(record.kind) as DispatchMessageKind;
  const text = normalizeString(record.text);
  if (!id || !text) {
    return null;
  }

  return {
    id,
    kind: kind || "note",
    text,
    from: normalizeString(record.from),
    to: normalizeString(record.to),
    fromSurface: normalizeString(record.fromSurface),
    toSurface: normalizeString(record.toSurface),
  };
}

function normalizeDispatchRecord(value: unknown): DispatchRecordPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const taskId = normalizeString(record.taskId);
  if (!taskId) {
    return null;
  }

  const messages = Array.isArray(record.messages)
    ? record.messages.map(normalizeDispatchMessage).filter((message): message is DispatchMessagePayload => message !== null)
    : [];

  return {
    taskId,
    initiator: normalizeString(record.initiator),
    worker: normalizeString(record.worker),
    workerId: normalizeString(record.workerId),
    workerName: normalizeString(record.workerName),
    qa: normalizeString(record.qa),
    qaMember: normalizeString(record.qaMember),
    qaSurface: normalizeString(record.qaSurface),
    messages,
  };
}

function resolveMemberIdBySurface(memberStatus: Map<string, TeamMemberStatus>, surface: string): string | null {
  const normalizedSurface = normalizeString(surface);
  if (!normalizedSurface) {
    return null;
  }

  for (const [memberId, status] of memberStatus.entries()) {
    if (status.surface === normalizedSurface) {
      return memberId;
    }
  }

  return null;
}

function resolveMemberIdByReference(members: Agent[], value: string): string | null {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    return null;
  }

  const member = members.find((entry) =>
    entry.id === normalizedValue ||
    entry.nameKo === normalizedValue ||
    entry.name === normalizedValue ||
    entry.emoji === normalizedValue,
  );
  return member?.id ?? null;
}

function resolveDispatchParticipantId(
  role: string,
  surface: string,
  dispatch: DispatchRecordPayload,
  members: Agent[],
  memberStatus: Map<string, TeamMemberStatus>,
): string | null {
  const bySurface = resolveMemberIdBySurface(memberStatus, surface);
  if (bySurface) {
    return bySurface;
  }

  switch (role) {
    case "worker":
      return (
        resolveMemberIdByReference(members, dispatch.workerId ?? "") ??
        resolveMemberIdByReference(members, dispatch.workerName ?? "") ??
        resolveMemberIdBySurface(memberStatus, dispatch.worker ?? "")
      );
    case "qa":
      return (
        resolveMemberIdBySurface(memberStatus, dispatch.qaSurface ?? "") ??
        resolveMemberIdByReference(members, dispatch.qaMember ?? "")
      );
    case "initiator":
      return resolveMemberIdBySurface(memberStatus, dispatch.initiator ?? "");
    case "surface":
      return resolveMemberIdBySurface(memberStatus, surface);
    default:
      return null;
  }
}

function shouldAnimateDispatchMessage(kind: DispatchMessageKind): boolean {
  return kind === "instruction" || kind === "question" || kind === "answer";
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
  const { applyLayout, syncCharactersFromTeam, playDispatchApproach } = useOfficeStore();
  const { setProjects } = useTeamStatusStore();
  const fetchTeamConfigFromStore = useTeamConfigStore((s) => s.fetch);
  const seenDispatchMessageIds = useRef(new Set<string>());

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
            break;
          case "dispatch-update": {
            const dispatch = normalizeDispatchRecord(evt.dispatch);
            const latestMessage = dispatch?.messages?.at(-1) ?? null;
            if (!dispatch || !latestMessage || seenDispatchMessageIds.current.has(latestMessage.id)) {
              break;
            }

            seenDispatchMessageIds.current.add(latestMessage.id);
            const members = useTeamConfigStore.getState().members;
            const memberStatus = useTeamStatusStore.getState().memberStatus;
            const actorId = resolveDispatchParticipantId(latestMessage.from, latestMessage.fromSurface, dispatch, members, memberStatus);
            const targetId = resolveDispatchParticipantId(latestMessage.to, latestMessage.toSurface, dispatch, members, memberStatus);

            if (actorId) {
              useDispatchVisualStore.getState().showBubble(actorId, latestMessage.text, latestMessage.kind);
            }
            if (actorId && targetId && actorId !== targetId && shouldAnimateDispatchMessage(latestMessage.kind)) {
              playDispatchApproach(actorId, targetId);
            }
            break;
          }
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
  }, [ws, upsertJob, setStats, addTokenUsage, setGitActivity, setPlans, applyLayout, setProjects, fetchTeamConfigFromStore, syncCharactersFromTeam, playDispatchApproach]);

  return { status };
}
