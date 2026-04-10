import { readFileSync } from "node:fs";

import { normalizeAllTeams } from "../../shared/team-normalizer.mjs";

export const RAW_TEAM_SCHEMA = JSON.parse(
  readFileSync(new URL("../../shared/team.json", import.meta.url), "utf8"),
);

const normalizedTeamData = normalizeAllTeams(RAW_TEAM_SCHEMA);

export const FLAT_TEAMS = normalizedTeamData.teams;
export const FLAT_TEAM_MEMBERS = normalizedTeamData.members;
export const TEAM_DATA = {
  teams: FLAT_TEAMS,
  members: FLAT_TEAM_MEMBERS,
};
