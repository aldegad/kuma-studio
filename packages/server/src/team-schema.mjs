import { readFileSync } from "node:fs";

const rawTeamSchema = JSON.parse(
  readFileSync(new URL("../../shared/team.json", import.meta.url), "utf8"),
);

function normalizeTeamName(teamId, team) {
  const ko = typeof team?.name === "string" && team.name.trim() ? team.name : teamId;
  const en = typeof team?.nameEn === "string" && team.nameEn.trim() ? team.nameEn : ko;
  return { ko, en };
}

function normalizeRoleLabel(member) {
  const ko = typeof member?.roleLabel?.ko === "string" && member.roleLabel.ko.trim()
    ? member.roleLabel.ko
    : String(member?.role ?? "");
  const en = typeof member?.roleLabel?.en === "string" && member.roleLabel.en.trim()
    ? member.roleLabel.en
    : String(member?.role ?? "");
  return { ko, en };
}

function normalizeEngine(member) {
  if (member?.spawnType === "claude" || member?.spawnType === "codex") {
    return member.spawnType;
  }
  if (member?.engine === "claude" || member?.engine === "codex") {
    return member.engine;
  }
  return String(member?.spawnModel ?? member?.model ?? "").startsWith("gpt-") ? "codex" : "claude";
}

function normalizeOffice(team) {
  return {
    origin: {
      x: typeof team?.office?.origin?.x === "number" ? team.office.origin.x : 220,
      y: typeof team?.office?.origin?.y === "number" ? team.office.origin.y : 160,
    },
    cols: typeof team?.office?.cols === "number" && team.office.cols > 0 ? team.office.cols : 2,
    hasSofa: team?.office?.hasSofa !== false,
    zoneColor: typeof team?.office?.zoneColor === "string" && team.office.zoneColor.trim()
      ? team.office.zoneColor
      : "rgba(107, 114, 128, 0.04)",
  };
}

function normalizeTeamMember(teamId, member) {
  return {
    id: member.id,
    name: {
      ko: member.name,
      en: typeof member?.nameEn === "string" && member.nameEn.trim() ? member.nameEn : member.id,
    },
    animal: {
      ko: typeof member?.animalKo === "string" ? member.animalKo : "",
      en: typeof member?.animalEn === "string" ? member.animalEn : "",
    },
    emoji: typeof member?.emoji === "string" ? member.emoji : "",
    model: typeof member?.spawnModel === "string" && member.spawnModel
      ? member.spawnModel
      : typeof member?.model === "string" ? member.model : "",
    engine: normalizeEngine(member),
    spawnType: member?.spawnType === "claude" || member?.spawnType === "codex" ? member.spawnType : normalizeEngine(member),
    spawnModel: typeof member?.spawnModel === "string" && member.spawnModel
      ? member.spawnModel
      : typeof member?.model === "string" ? member.model : "",
    spawnOptions: typeof member?.spawnOptions === "string" ? member.spawnOptions : "",
    effort: typeof member?.effort === "string" ? member.effort : null,
    serviceTier: typeof member?.serviceTier === "string" ? member.serviceTier : null,
    team: typeof member?.team === "string" && member.team ? member.team : teamId,
    nodeType: typeof member?.nodeType === "string" ? member.nodeType : "worker",
    parentId: typeof member?.parentId === "string" ? member.parentId : member?.parentId === null ? null : null,
    role: normalizeRoleLabel(member),
    roleId: String(member?.role ?? ""),
    skills: Array.isArray(member?.skills) ? member.skills : [],
    capabilities: Array.isArray(member?.capabilities) ? member.capabilities : [],
    parallel: member?.parallel === true,
    image: typeof member?.image === "string" ? member.image : "",
    defaultSurface: typeof member?.defaultSurface === "string" ? member.defaultSurface : null,
  };
}

const TEAM_DEFINITION_ENTRIES = Object.entries(rawTeamSchema.teams ?? {});

export const FLAT_TEAMS = TEAM_DEFINITION_ENTRIES.map(([teamId, team]) => ({
  id: teamId,
  name: normalizeTeamName(teamId, team),
  pm: typeof team?.leadId === "string" && team.leadId ? team.leadId : null,
  skill: typeof team?.skill === "string" ? team.skill : "",
  office: normalizeOffice(team),
}));

export const FLAT_TEAM_MEMBERS = TEAM_DEFINITION_ENTRIES.flatMap(([teamId, team]) =>
  Array.isArray(team?.members)
    ? team.members.map((member) => normalizeTeamMember(teamId, member))
    : [],
);

export const TEAM_DATA = {
  teams: FLAT_TEAMS,
  members: FLAT_TEAM_MEMBERS,
};
