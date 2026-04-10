import { teamData } from "../lib/team-schema";

export type AgentState = "idle" | "working" | "thinking" | "completed" | "error";
export type NodeType = "session" | "team" | "worker";
export type ModelType = "claude" | "codex";
export type TeamSkillId = "kuma" | "dev-team" | "analytics-team" | "strategy-team";
export type InstalledSkillId =
  | "codex-autoresearch"
  | "frontend-design"
  | "gateproof-full-security-check"
  | "imagegen"
  | "kuma-picker";
export type CapabilitySkillId = "nano-banana" | "security-threat-intel";
export type AgentSkillId =
  | TeamSkillId
  | InstalledSkillId
  | CapabilitySkillId
  | `codex-autoresearch:${string}`;

export interface Agent {
  id: string;
  name: string;
  nameKo: string;
  animal: string;
  animalKo: string;
  role: string;
  roleKo: string;
  team: string;
  teamKo: string;
  state: AgentState;
  nodeType?: NodeType;
  parentId?: string;
  model?: string;
  modelCatalogId?: string;
  engine?: string;
  effort?: string | null;
  serviceTier?: string | null;
  emoji?: string;
  image?: string;
  skills?: AgentSkillId[];
}

export interface TeamMetadataMember {
  id: string;
  emoji: string;
  displayName: string;
  model: string;
  role: string;
}

export interface TeamMetadataTeam {
  name: string;
  emoji: string;
  members: TeamMetadataMember[];
}

export interface TeamMetadataResponse {
  teams: TeamMetadataTeam[];
}

export interface ModelCatalogEntry {
  id: string;
  type: ModelType;
  model: string;
  label: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  serviceTier?: "default" | "fast";
  options?: string;
}

export interface TeamConfigMember {
  id: string;
  emoji: string;
  role: string;
  team: string;
  nodeType: string;
  type: string;
  model: string;
  modelCatalogId: string;
  options: string;
  nameEn: string;
  animalKo: string;
  animalEn: string;
  image: string;
  skills: string[];
  parentId: string | null;
}

export interface TeamConfigDefault {
  model: string;
  options: string;
  modelCatalogId: string;
}

export interface TeamConfigResponse {
  members: Record<string, TeamConfigMember>;
  defaults: Record<string, TeamConfigDefault>;
  modelCatalog: ModelCatalogEntry[];
}

type SharedTeamMember = (typeof teamData.members)[number];

const TEAM_NAME_BY_ID = new Map(teamData.teams.map((team) => [team.id, team.name] as const));
const VALID_CODEX_REASONING_LEVELS = new Set(["low", "medium", "high", "xhigh"]);

// team.json is the single source of truth — skills array contains only valid IDs
const AGENT_SKILL_IDS = new Set<string>(teamData.members.flatMap((m) => m.skills));

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

function deriveRuntimeDetails(type: string | undefined, options: string) {
  if (type !== "codex") {
    return { effort: null, serviceTier: null };
  }

  const reasoning = readCodexOption(options, ["model_reasoning_effort", "reasoning_effort"]).toLowerCase();
  return {
    effort: VALID_CODEX_REASONING_LEVELS.has(reasoning) ? reasoning : null,
    serviceTier: readCodexOption(options, ["service_tier"]) || null,
  };
}

function toNodeType(nodeType: SharedTeamMember["nodeType"]): NodeType {
  if (nodeType === "session" || nodeType === "team" || nodeType === "worker") {
    return nodeType;
  }

  throw new Error(`Unsupported node type: ${String(nodeType)}`);
}

function toAgentSkills(skills: SharedTeamMember["skills"]): AgentSkillId[] | undefined {
  const agentSkills = skills.filter((skill): skill is AgentSkillId => AGENT_SKILL_IDS.has(skill as AgentSkillId));
  return agentSkills.length > 0 ? agentSkills : undefined;
}

function mapTeamMemberToAgent(member: SharedTeamMember): Agent {
  const teamName = TEAM_NAME_BY_ID.get(member.team);

  if (!teamName) {
    throw new Error(`Unknown team for member ${member.id}: ${member.team}`);
  }

  return {
    id: member.id,
    name: member.name.en,
    nameKo: member.name.ko,
    animal: member.animal.en,
    animalKo: member.animal.ko,
    role: member.role.en,
    roleKo: member.role.ko,
    team: member.team,
    teamKo: teamName.ko,
    state: "idle",
    nodeType: toNodeType(member.nodeType),
    parentId: member.parentId ?? undefined,
    model: member.model,
    modelCatalogId: member.modelCatalogId ?? undefined,
    engine: member.engine,
    effort: member.effort,
    serviceTier: member.serviceTier,
    emoji: member.emoji,
    image: member.image,
    skills: toAgentSkills(member.skills),
  };
}

export const KUMA_TEAM: Agent[] = teamData.members.map(mapTeamMemberToAgent);

const AGENT_INDEX_BY_ID = new Map(KUMA_TEAM.map((agent, index) => [agent.id, index]));

export function applyTeamMetadata(metadata: TeamMetadataResponse): Agent[] {
  for (const team of metadata.teams) {
    for (const member of team.members) {
      const index = AGENT_INDEX_BY_ID.get(member.id);
      if (index == null) continue;

      const current = KUMA_TEAM[index];
      KUMA_TEAM[index] = {
        ...current,
        nameKo: member.displayName,
        roleKo: member.role,
        model: member.model,
        emoji: member.emoji,
      };
    }
  }
  return KUMA_TEAM;
}

const TEAM_NAME_KO_BY_ID = new Map(teamData.teams.map((t) => [t.id, t.name.ko] as const));

export function teamConfigToAgents(config: TeamConfigResponse): Agent[] {
  return Object.entries(config.members).map(([nameKo, m]) => {
    const runtime = deriveRuntimeDetails(m.type, m.options);

    return {
      id: m.id,
      name: m.nameEn || m.id,
      nameKo,
      animal: m.animalEn || "",
      animalKo: m.animalKo || "",
      role: "",
      roleKo: m.role,
      team: m.team,
      teamKo: TEAM_NAME_KO_BY_ID.get(m.team) ?? m.team,
      state: "idle" as AgentState,
      nodeType: (m.nodeType || "worker") as NodeType,
      parentId: m.parentId ?? undefined,
      model: m.model,
      modelCatalogId: m.modelCatalogId || undefined,
      engine: m.type,
      effort: runtime.effort,
      serviceTier: runtime.serviceTier,
      emoji: m.emoji,
      image: m.image || undefined,
      skills: m.skills?.length ? (m.skills as AgentSkillId[]) : undefined,
    };
  });
}
