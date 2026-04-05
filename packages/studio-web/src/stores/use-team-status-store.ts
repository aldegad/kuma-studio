import { create } from "zustand";
import teamData from "../../../shared/team.json";
import type { Agent, AgentState } from "../types/agent";
import { KUMA_TEAM } from "../types/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamMemberStatus {
  id: string;
  state: AgentState;
  lastOutputLines: string[];
  task: string | null;
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
  projectName: "Kuma Studio",
  members: KUMA_TEAM.map((agent) => ({
    id: agent.id,
    state: "idle" as AgentState,
    lastOutputLines: [],
    task: null,
    updatedAt: null,
  })),
};

export const useTeamStatusStore = create<TeamStatusState>((set) => ({
  projects: [DEFAULT_PROJECT],
  activeProjectId: null,
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
  const projectMembers = activeProjectId
    ? projects.find((p) => p.projectId === activeProjectId)?.members
    : projects.flatMap((p) => p.members);

  const activeMemberIds = new Set(projectMembers?.map((m) => m.id) ?? KUMA_TEAM.map((a) => a.id));

  // Group agents by team
  const groups: TeamGroup[] = teamData.teams
    .filter((t) => t.id !== "management") // management shown separately or inline
    .map((team) => ({
      teamId: team.id,
      label: team.name.ko,
      emoji: team.pm ? KUMA_TEAM.find((a) => a.id === team.pm)?.emoji ?? "" : "",
      members: KUMA_TEAM
        .filter((a) => a.team === team.id && activeMemberIds.has(a.id))
        .map((agent) => ({
          ...agent,
          status: memberStatus.get(agent.id) ?? {
            id: agent.id,
            state: "idle" as AgentState,
            lastOutputLines: [],
            task: null,
            updatedAt: null,
          },
        })),
    }))
    .filter((g) => g.members.length > 0);

  // Prepend management if any management members are active
  const mgmtMembers = KUMA_TEAM
    .filter((a) => a.team === "management" && activeMemberIds.has(a.id))
    .map((agent) => ({
      ...agent,
      status: memberStatus.get(agent.id) ?? {
        id: agent.id,
        state: "idle" as AgentState,
        lastOutputLines: [],
        task: null,
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
