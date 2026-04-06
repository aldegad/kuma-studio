import { create } from "zustand";
import teamData from "../../../shared/team.json";
import type { Agent, AgentState } from "../types/agent.js";
import { KUMA_TEAM } from "../types/agent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelInfo {
  model: string | null;
  effort: string | null;
  speed: string | null;
  contextRemaining: number | null;
}

export interface TeamMemberStatus {
  id: string;
  state: AgentState;
  lastOutputLines: string[];
  task: string | null;
  modelInfo: ModelInfo | null;
  updatedAt: string | null;
}

export interface ProjectTeamStatus {
  projectId: string;
  projectName: string;
  members: TeamMemberStatus[];
}

export interface TeamStatusSnapshot {
  projects: ProjectTeamStatus[];
}

type TeamStatusApiMember = {
  id?: unknown;
  name?: unknown;
  state?: unknown;
  status?: unknown;
  lastOutput?: unknown;
  lastOutputLines?: unknown;
  task?: unknown;
  modelInfo?: unknown;
  updatedAt?: unknown;
};

type TeamStatusApiProject = {
  projectId?: unknown;
  projectName?: unknown;
  members?: unknown;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface TeamStatusState {
  /** All projects returned from the API */
  projects: ProjectTeamStatus[];
  /** Currently selected project tab (null = all) */
  activeProjectId: string | null;
  /** Per-member status overlay (keyed by member id) */
  memberStatus: Map<string, TeamMemberStatus>;
  /** Loading / error */
  loading: boolean;
  error: string | null;

  setProjects: (projects: ProjectTeamStatus[]) => void;
  setActiveProject: (projectId: string | null) => void;
  updateMemberStatus: (update: TeamMemberStatus) => void;
  batchUpdateMembers: (updates: TeamMemberStatus[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

/** Default project derived from team.json when API is unavailable */
const DEFAULT_PROJECT: ProjectTeamStatus = {
  projectId: "kuma-studio",
  projectName: "kuma-studio",
  members: KUMA_TEAM.map((agent: Agent) => ({
    id: agent.id,
    state: "idle" as AgentState,
    lastOutputLines: [],
    task: null,
    modelInfo: null,
    updatedAt: null,
  })),
};

export const useTeamStatusStore = create<TeamStatusState>((set) => ({
  projects: [DEFAULT_PROJECT],
  activeProjectId: "kuma-studio",
  memberStatus: new Map(),
  loading: false,
  error: null,

  setProjects: (projects) => {
    const memberStatus = new Map<string, TeamMemberStatus>();
    for (const project of projects) {
      for (const member of project.members) {
        memberStatus.set(member.id, member);
      }
    }
    set({ projects, memberStatus, error: null });
  },

  setActiveProject: (projectId) => set({ activeProjectId: projectId }),

  updateMemberStatus: (update) =>
    set((state) => {
      const next = new Map(state.memberStatus);
      next.set(update.id, update);
      return { memberStatus: next };
    }),

  batchUpdateMembers: (updates) =>
    set((state) => {
      const next = new Map(state.memberStatus);
      for (const update of updates) {
        next.set(update.id, update);
      }
      return { memberStatus: next };
    }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

const teamById = new Map(teamData.teams.map((t) => [t.id, t] as const));
const memberIdByDisplayName = new Map(teamData.members.map((member) => [member.name.ko, member.id] as const));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizeMemberState(value: unknown): AgentState {
  switch (value) {
    case "idle":
    case "working":
    case "thinking":
    case "completed":
    case "error":
      return value;
    case "dead":
      return "error";
    default:
      return "idle";
  }
}

function normalizeLastOutputLines(member: TeamStatusApiMember): string[] {
  if (Array.isArray(member.lastOutputLines)) {
    return member.lastOutputLines.filter((line): line is string => typeof line === "string");
  }

  if (typeof member.lastOutput === "string") {
    return member.lastOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-3);
  }

  return [];
}

function normalizeModelInfo(value: unknown): ModelInfo | null {
  if (!isRecord(value)) return null;
  const info = value as Record<string, unknown>;
  const model = typeof info.model === "string" ? info.model : null;
  const effort = typeof info.effort === "string" ? info.effort : null;
  const speed = typeof info.speed === "string" ? info.speed : null;
  const contextRemaining = typeof info.contextRemaining === "number" ? info.contextRemaining : null;
  if (!model && !effort && !speed && contextRemaining === null) return null;
  return { model, effort, speed, contextRemaining };
}

function normalizeMember(member: unknown): TeamMemberStatus | null {
  if (!isRecord(member)) {
    return null;
  }

  const apiMember = member as TeamStatusApiMember;
  const id =
    typeof apiMember.id === "string" && apiMember.id.trim()
      ? apiMember.id
      : typeof apiMember.name === "string"
        ? memberIdByDisplayName.get(apiMember.name.trim()) ?? null
        : null;

  if (!id) {
    return null;
  }

  return {
    id,
    state: normalizeMemberState(apiMember.state ?? apiMember.status),
    lastOutputLines: normalizeLastOutputLines(apiMember),
    task: typeof apiMember.task === "string" && apiMember.task.trim() ? apiMember.task : null,
    modelInfo: normalizeModelInfo(apiMember.modelInfo),
    updatedAt: typeof apiMember.updatedAt === "string" ? apiMember.updatedAt : null,
  };
}

function normalizeProject(projectId: string, projectName: string, members: unknown): ProjectTeamStatus {
  return {
    projectId,
    projectName,
    members: Array.isArray(members)
      ? members.map(normalizeMember).filter((member): member is TeamMemberStatus => member !== null)
      : [],
  };
}

export function normalizeTeamStatusSnapshot(value: unknown): TeamStatusSnapshot | null {
  if (!isRecord(value) || !("projects" in value)) {
    return null;
  }

  const { projects } = value;

  if (Array.isArray(projects)) {
    return {
      projects: projects
        .filter((project): project is TeamStatusApiProject => isRecord(project))
        .map((project) => {
          const projectId = typeof project.projectId === "string" ? project.projectId : "unknown";
          const projectName =
            typeof project.projectName === "string" && project.projectName.trim()
              ? project.projectName
              : projectId;
          return normalizeProject(projectId, projectName, project.members);
        }),
    };
  }

  if (!isRecord(projects)) {
    return null;
  }

  return {
    projects: Object.entries(projects).map(([projectId, project]) => {
      const members = isRecord(project) ? project.members : [];
      return normalizeProject(projectId, projectId, members);
    }),
  };
}

export function extractTeamStatusSnapshotFromWsMessage(value: unknown): TeamStatusSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.type === "kuma-studio:team-status-update") {
    return normalizeTeamStatusSnapshot(value.snapshot ?? value.teamStatus ?? value);
  }

  if (
    value.type === "kuma-studio:event" &&
    isRecord(value.event) &&
    value.event.kind === "kuma-studio:team-status-update"
  ) {
    return normalizeTeamStatusSnapshot(value.event.snapshot ?? value.event.teamStatus ?? value.event);
  }

  return null;
}

export interface TeamGroup {
  teamId: string;
  label: string;
  emoji: string;
  members: (Agent & { status: TeamMemberStatus })[];
}

/** Get team groups for the active project, merging live status */
export function getTeamGroups(
  activeProjectId: string | null,
  projects: ProjectTeamStatus[],
  memberStatus: Map<string, TeamMemberStatus>,
): TeamGroup[] {
  // Determine which member IDs are in the active project
  // "system" project members (e.g. jjooni) are always visible regardless of active tab
  const systemMembers = projects.find((p) => p.projectId === "system")?.members ?? [];
  const projectMembers = activeProjectId
    ? [...(projects.find((p) => p.projectId === activeProjectId)?.members ?? []), ...systemMembers]
    : projects.flatMap((p) => p.members);

  const activeMemberIds = new Set(
    projectMembers.length > 0
      ? projectMembers.map((m: TeamMemberStatus) => m.id)
      : KUMA_TEAM.map((a: Agent) => a.id),
  );

  // Group agents by team
  const groups: TeamGroup[] = teamData.teams
    .filter((t) => t.id !== "management") // management shown separately or inline
    .map((team) => ({
      teamId: team.id,
      label: team.name.ko,
      emoji: team.pm ? KUMA_TEAM.find((a: Agent) => a.id === team.pm)?.emoji ?? "" : "",
      members: KUMA_TEAM
        .filter((a: Agent) => a.team === team.id && activeMemberIds.has(a.id))
        .map((agent: Agent) => ({
          ...agent,
          status: memberStatus.get(agent.id) ?? {
            id: agent.id,
            state: "idle" as AgentState,
            lastOutputLines: [],
            task: null,
            modelInfo: null,
            updatedAt: null,
          },
        })),
    }))
    .filter((g) => g.members.length > 0);

  // Prepend management if any management members are active
  const mgmtMembers = KUMA_TEAM
    .filter((a: Agent) => a.team === "management" && activeMemberIds.has(a.id))
    .map((agent: Agent) => ({
      ...agent,
      status: memberStatus.get(agent.id) ?? {
        id: agent.id,
        state: "idle" as AgentState,
        lastOutputLines: [],
        task: null,
        modelInfo: null,
        updatedAt: null,
      },
    }));

  if (mgmtMembers.length > 0) {
    const mgmtTeam = teamById.get("management");
    groups.unshift({
      teamId: "management",
      label: mgmtTeam?.name.ko ?? "총괄",
      emoji: "🐻",
      members: mgmtMembers,
    });
  }

  return groups;
}
