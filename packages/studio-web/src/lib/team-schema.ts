import rawTeamSchema from "../../../shared/team.json";
import {
  normalizeAllTeams,
  type NormalizedTeamData,
  type NormalizedTeamDefinition,
  type NormalizedTeamMember,
  type NormalizedTeamOffice,
} from "../../../shared/team-normalizer.mjs";

export type FlatTeamOffice = NormalizedTeamOffice;
export type FlatTeamDefinition = NormalizedTeamDefinition;
export type FlatTeamMember = NormalizedTeamMember;

const normalizedTeamData = normalizeAllTeams(rawTeamSchema) as NormalizedTeamData;

export const flatTeams: FlatTeamDefinition[] = normalizedTeamData.teams;
export const flatTeamMembers: FlatTeamMember[] = normalizedTeamData.members;
export const teamData: NormalizedTeamData = {
  teams: flatTeams,
  members: flatTeamMembers,
  allTeams: normalizedTeamData.allTeams,
};
