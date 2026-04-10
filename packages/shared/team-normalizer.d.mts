export interface TeamName {
  ko: string;
  en: string;
}

export interface AnimalName {
  ko: string;
  en: string;
}

export interface RoleLabel {
  ko: string;
  en: string;
}

export interface NormalizedTeamOffice {
  origin: { x: number; y: number };
  cols: number;
  hasSofa: boolean;
  zoneColor: string;
}

export interface NormalizedTeamDefinition {
  id: string;
  name: TeamName;
  pm: string | null;
  skill: string;
  office: NormalizedTeamOffice;
  deprecated: boolean;
  aliasFor: string | null;
}

export interface NormalizedTeamMember {
  id: string;
  name: TeamName;
  animal: AnimalName;
  emoji: string;
  model: string;
  engine: "claude" | "codex";
  options: string;
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
  defaultQa: string | null;
}

export interface NormalizedTeamData {
  teams: NormalizedTeamDefinition[];
  members: NormalizedTeamMember[];
  allTeams: NormalizedTeamDefinition[];
}

export const DEFAULT_MODELS: Readonly<{ claude: string; codex: string }>;
export const DEFAULT_OPTIONS: Readonly<{ claude: string; codex: string }>;
export const VALID_CODEX_REASONING_LEVELS: Set<string>;

export function normalizeWhitespace(value: unknown): string;
export function readCodexOption(options: string, settingNames: string[]): string;
export function normalizeCodexOptions(options: string, fallbackOptions?: string): string;
export function normalizeTeamName(teamId: string, team: any): TeamName;
export function normalizeRoleLabel(member: any): RoleLabel;
export function normalizeEngine(member: any): "claude" | "codex";
export function normalizeModel(member: any, engine: "claude" | "codex"): string;
export function normalizeOptions(member: any, engine: "claude" | "codex"): string;
export function deriveEffort(engine: "claude" | "codex", options: string): string | null;
export function deriveServiceTier(engine: "claude" | "codex", options: string): string | null;
export function normalizeOfficePoint(point: any): { x: number; y: number };
export function normalizeOffice(team: any): NormalizedTeamOffice;
export function isDeprecatedTeam(team: any): boolean;
export function normalizeTeam(teamId: string, team: any): NormalizedTeamDefinition;
export function normalizeTeamMember(teamId: string, member: any): NormalizedTeamMember;
export function normalizeAllTeams(rawTeamJson: any): NormalizedTeamData;
export function findMemberByDisplayName(data: Pick<NormalizedTeamData, "members">, name: string): NormalizedTeamMember | null;
export function findMemberByQuery(data: Pick<NormalizedTeamData, "members">, query: string): NormalizedTeamMember | null;
export function listBootstrapSystemMembers(data: Pick<NormalizedTeamData, "members">): string[];
export function listProjectSpawnMembers(data: Pick<NormalizedTeamData, "members">): string[];
