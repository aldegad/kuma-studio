import { readFileSync } from "node:fs";

const rawTeamSchema = JSON.parse(
  readFileSync(new URL("../../shared/team.json", import.meta.url), "utf8"),
);
const DEFAULT_MODELS = {
  claude: "claude-opus-4-6",
  codex: "gpt-5.4",
};
const DEFAULT_OPTIONS = {
  claude: "--dangerously-skip-permissions",
  codex: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
};
const VALID_CODEX_REASONING_LEVELS = new Set(["low", "medium", "high", "xhigh"]);

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
  return String(member?.spawnModel ?? "").startsWith("gpt-") ? "codex" : "claude";
}

function normalizeModel(member, engine) {
  if (typeof member?.spawnModel === "string" && member.spawnModel.trim()) {
    return member.spawnModel;
  }

  return DEFAULT_MODELS[engine] ?? DEFAULT_MODELS.claude;
}

function normalizeOptions(member, engine) {
  const raw = typeof member?.spawnOptions === "string" && member.spawnOptions.trim()
    ? member.spawnOptions
    : DEFAULT_OPTIONS[engine] ?? DEFAULT_OPTIONS.claude;
  return raw.trim();
}

function readCodexOption(options, settingNames) {
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

function deriveEffort(engine, options) {
  if (engine !== "codex") {
    return null;
  }

  const reasoning = readCodexOption(options, ["model_reasoning_effort", "reasoning_effort"]).toLowerCase();
  return VALID_CODEX_REASONING_LEVELS.has(reasoning) ? reasoning : null;
}

function deriveServiceTier(engine, options) {
  if (engine !== "codex") {
    return null;
  }

  return readCodexOption(options, ["service_tier"]) || null;
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
  const engine = normalizeEngine(member);
  const model = normalizeModel(member, engine);
  const options = normalizeOptions(member, engine);

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
    model,
    engine,
    effort: deriveEffort(engine, options),
    serviceTier: deriveServiceTier(engine, options),
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
