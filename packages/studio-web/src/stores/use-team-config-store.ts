import { create } from "zustand";
import { KUMA_TEAM, teamConfigToAgents, type Agent, type ModelCatalogEntry, type TeamConfigResponse } from "../types/agent";
import { fetchTeamConfig } from "../lib/api";

interface TeamConfigState {
  members: Agent[];
  modelCatalog: readonly ModelCatalogEntry[];
  loaded: boolean;
  fetch: () => Promise<Agent[]>;
}

export const useTeamConfigStore = create<TeamConfigState>((set) => ({
  members: KUMA_TEAM,
  modelCatalog: [],
  loaded: false,

  fetch: async () => {
    const config: TeamConfigResponse = await fetchTeamConfig();
    const agents = teamConfigToAgents(config);
    set({
      members: agents,
      modelCatalog: Array.isArray(config.modelCatalog) ? [...config.modelCatalog] : [],
      loaded: true,
    });
    return agents;
  },
}));
