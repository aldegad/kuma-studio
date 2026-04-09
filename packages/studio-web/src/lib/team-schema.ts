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
const DEFAULT_MODELS = {
  claude: "claude-opus-4-6",
  codex: "gpt-5.4",
} as const;
const DEFAULT_OPTIONS = {
  claude: "--dangerously-skip-permissions",
  codex: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
} as const;
const VALID_CODEX_REASONING_LEVELS = new Set(["low", "medium", "high", "xhigh"]);

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
  return String(member.spawnModel ?? "").startsWith("gpt-") ? "codex" : "claude";
}

function normalizeModel(member: RawTeamMember, engine: string): string {
  if (typeof member.spawnModel === "string" && member.spawnModel.trim()) {
    return member.spawnModel;
  }

  return DEFAULT_MODELS[engine as keyof typeof DEFAULT_MODELS] ?? DEFAULT_MODELS.claude;
}

function normalizeOptions(member: RawTeamMember, engine: string): string {
  const raw = typeof member.spawnOptions === "string" && member.spawnOptions.trim()
    ? member.spawnOptions
    : DEFAULT_OPTIONS[engine as keyof typeof DEFAULT_OPTIONS] ?? DEFAULT_OPTIONS.claude;
  return raw.trim();
}

function readCodexOption(options: string, settingNames: string[]): string {
  const normalized = String(options ?? "").trim();
  if (!normalized) {
    return "";
  }

  for (const settingName of settingNames) {
    const pattern = new RegExp(
      `(?:^|\\s)-c\\s+${settingName}=(?:"([^"]*)"|'([^']*)'|(\\S+))`,
      "u",
    );
    const match = normalized.match(pattern);
    if (match) {
      return String(match[1] ?? match[2] ?? match[3] ?? "");
    }
  }

  return "";
}

function deriveEffort(engine: string, options: string): string | null {
  if (engine !== "codex") {
    return null;
  }

  const reasoning = readCodexOption(options, ["model_reasoning_effort", "reasoning_effort"]).toLowerCase();
  return VALID_CODEX_REASONING_LEVELS.has(reasoning) ? reasoning : null;
}

function deriveServiceTier(engine: string, options: string): string | null {
  if (engine !== "codex") {
    return null;
  }

  return readCodexOption(options, ["service_tier"]) || null;
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
  const engine = normalizeEngine(member);
  const model = normalizeModel(member, engine);
  const options = normalizeOptions(member, engine);

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
    model,
    engine,
    effort: deriveEffort(engine, options),
    serviceTier: deriveServiceTier(engine, options),
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
