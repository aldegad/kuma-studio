import rawTeamSchema from "../../../shared/team.json";

type TeamName = { ko: string; en: string };
type AnimalName = { ko: string; en: string };
type RoleLabel = { ko: string; en: string };
type OfficePoint = { x: number; y: number };

export interface FlatTeamOffice {
  origin: OfficePoint;
  cols: number;
  hasSofa: boolean;
  zoneColor: string;
}

interface RawTeamOffice {
  origin?: { x?: number; y?: number };
  cols?: number;
  hasSofa?: boolean;
  zoneColor?: string;
}

interface RawTeamMember {
  id: string;
  name: string;
  nameEn?: string;
  emoji?: string;
  team?: string;
  role: string;
  roleLabel?: RoleLabel;
  spawnType?: string;
  spawnModel?: string;
  spawnOptions?: string;
  engine?: string;
  model?: string;
  effort?: string;
  serviceTier?: string;
  capabilities?: string[];
  skills?: string[];
  nodeType?: string;
  parentId?: string | null;
  parallel?: boolean;
  image?: string;
  animalKo?: string;
  animalEn?: string;
  defaultSurface?: string;
}

interface RawTeamDefinition {
  name: string;
  nameEn?: string;
  skill?: string;
  leadId?: string | null;
  office?: RawTeamOffice;
  members?: RawTeamMember[];
}

interface RawTeamSchema {
  teams: Record<string, RawTeamDefinition>;
}

export interface FlatTeamDefinition {
  id: string;
  name: TeamName;
  pm: string | null;
  skill: string;
  office: FlatTeamOffice;
}

export interface FlatTeamMember {
  id: string;
  name: TeamName;
  animal: AnimalName;
  emoji: string;
  model: string;
  engine: string;
  spawnType: string;
  spawnModel: string;
  spawnOptions: string;
  effort: string | null;
  serviceTier: string | null;
  team: string;
  nodeType: string;
  parentId: string | null;
  role: RoleLabel;
  roleId: string;
  skills: string[];
  capabilities: string[];
  parallel: boolean;
  image: string;
  defaultSurface: string | null;
}

const teamSchema = rawTeamSchema as RawTeamSchema;

function normalizeTeamName(teamId: string, team: RawTeamDefinition): TeamName {
  const ko = typeof team.name === "string" && team.name.trim() ? team.name : teamId;
  const en = typeof team.nameEn === "string" && team.nameEn.trim() ? team.nameEn : ko;
  return { ko, en };
}

function normalizeRoleLabel(member: RawTeamMember): RoleLabel {
  const ko = typeof member.roleLabel?.ko === "string" && member.roleLabel.ko.trim()
    ? member.roleLabel.ko
    : member.role;
  const en = typeof member.roleLabel?.en === "string" && member.roleLabel.en.trim()
    ? member.roleLabel.en
    : member.role;
  return { ko, en };
}

function normalizeEngine(member: RawTeamMember): string {
  if (member.spawnType === "claude" || member.spawnType === "codex") {
    return member.spawnType;
  }
  if (member.engine === "claude" || member.engine === "codex") {
    return member.engine;
  }
  return String(member.spawnModel ?? member.model ?? "").startsWith("gpt-") ? "codex" : "claude";
}

function normalizeOfficePoint(point?: RawTeamOffice["origin"]): OfficePoint {
  return {
    x: typeof point?.x === "number" ? point.x : 220,
    y: typeof point?.y === "number" ? point.y : 160,
  };
}

function normalizeOffice(team: RawTeamDefinition): FlatTeamOffice {
  return {
    origin: normalizeOfficePoint(team.office?.origin),
    cols: typeof team.office?.cols === "number" && team.office.cols > 0 ? team.office.cols : 2,
    hasSofa: team.office?.hasSofa !== false,
    zoneColor: typeof team.office?.zoneColor === "string" && team.office.zoneColor.trim()
      ? team.office.zoneColor
      : "rgba(107, 114, 128, 0.04)",
  };
}

function normalizeTeamMember(teamId: string, member: RawTeamMember): FlatTeamMember {
  return {
    id: member.id,
    name: {
      ko: member.name,
      en: typeof member.nameEn === "string" && member.nameEn.trim() ? member.nameEn : member.id,
    },
    animal: {
      ko: typeof member.animalKo === "string" ? member.animalKo : "",
      en: typeof member.animalEn === "string" ? member.animalEn : "",
    },
    emoji: typeof member.emoji === "string" ? member.emoji : "",
    model: typeof member.spawnModel === "string" && member.spawnModel
      ? member.spawnModel
      : typeof member.model === "string" ? member.model : "",
    engine: normalizeEngine(member),
    spawnType: member.spawnType === "claude" || member.spawnType === "codex" ? member.spawnType : normalizeEngine(member),
    spawnModel: typeof member.spawnModel === "string" && member.spawnModel
      ? member.spawnModel
      : typeof member.model === "string" ? member.model : "",
    spawnOptions: typeof member.spawnOptions === "string" ? member.spawnOptions : "",
    effort: typeof member.effort === "string" ? member.effort : null,
    serviceTier: typeof member.serviceTier === "string" ? member.serviceTier : null,
    team: typeof member.team === "string" && member.team ? member.team : teamId,
    nodeType: typeof member.nodeType === "string" ? member.nodeType : "worker",
    parentId: typeof member.parentId === "string" ? member.parentId : member.parentId === null ? null : null,
    role: normalizeRoleLabel(member),
    roleId: member.role,
    skills: Array.isArray(member.skills) ? member.skills : [],
    capabilities: Array.isArray(member.capabilities) ? member.capabilities : [],
    parallel: member.parallel === true,
    image: typeof member.image === "string" ? member.image : "",
    defaultSurface: typeof member.defaultSurface === "string" ? member.defaultSurface : null,
  };
}

const TEAM_DEFINITION_ENTRIES = Object.entries(teamSchema.teams ?? {});

export const flatTeams: FlatTeamDefinition[] = TEAM_DEFINITION_ENTRIES.map(([teamId, team]) => ({
  id: teamId,
  name: normalizeTeamName(teamId, team),
  pm: typeof team.leadId === "string" && team.leadId ? team.leadId : null,
  skill: typeof team.skill === "string" ? team.skill : "",
  office: normalizeOffice(team),
}));

export const flatTeamMembers: FlatTeamMember[] = TEAM_DEFINITION_ENTRIES.flatMap(([teamId, team]) =>
  Array.isArray(team.members)
    ? team.members.map((member) => normalizeTeamMember(teamId, member))
    : [],
);

export const teamData = {
  teams: flatTeams,
  members: flatTeamMembers,
};
