import { create } from "zustand";
import { KUMA_TEAM, teamConfigToAgents, type Agent, type TeamConfigResponse } from "../types/agent";
import { fetchTeamConfig } from "../lib/api";

interface TeamConfigState {
  members: Agent[];
  loaded: boolean;
  fetch: () => Promise<Agent[]>;
}

export const useTeamConfigStore = create<TeamConfigState>((set) => ({
  members: KUMA_TEAM,
  loaded: false,

  fetch: async () => {
    const config: TeamConfigResponse = await fetchTeamConfig();
    const agents = teamConfigToAgents(config);
    set({ members: agents, loaded: true });
    return agents;
  },
}));
