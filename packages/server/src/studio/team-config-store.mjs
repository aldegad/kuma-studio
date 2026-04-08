import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_TEAM_JSON_PATH = `${homedir()}/.kuma/team.json`;
export const DEFAULT_TEAM_CONFIG_PATH = DEFAULT_TEAM_JSON_PATH;

const BUNDLED_TEAM_SCHEMA_PATH = new URL("../../../shared/team.json", import.meta.url);

const CODEX_BASE_OPTIONS = "--dangerously-bypass-approvals-and-sandbox -c service_tier=fast";
const CODEX_REASONING_OPTION = '-c model_reasoning_effort="xhigh"';
const CODEX_REASONING_OPTION_PATTERN = /(?:^|\s)-c\s+(?:model_)?reasoning_effort=(?:"[^"]*"|'[^']*'|\S+)/gu;

const DEFAULTS = {
  claude: {
    model: "claude-opus-4-6",
    options: "--dangerously-skip-permissions",
  },
  codex: {
    model: "gpt-5.4",
    options: `${CODEX_BASE_OPTIONS} ${CODEX_REASONING_OPTION}`,
  },
};

function normalizeWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function normalizeCodexOptions(options) {
  const withoutReasoning = normalizeWhitespace(
    String(options ?? "").replace(CODEX_REASONING_OPTION_PATTERN, " "),
  );

  if (!withoutReasoning) {
    return DEFAULTS.codex.options;
  }

  return normalizeWhitespace(`${withoutReasoning} ${CODEX_REASONING_OPTION}`);
}

function normalizeConfigDefaults(rawDefaults) {
  const defaults = {
    claude: {
      ...DEFAULTS.claude,
      ...(rawDefaults?.claude ?? {}),
    },
    codex: {
      ...DEFAULTS.codex,
      ...(rawDefaults?.codex ?? {}),
    },
  };

  defaults.codex.options = normalizeCodexOptions(defaults.codex.options);
  defaults.claude.options = normalizeWhitespace(defaults.claude.options) || DEFAULTS.claude.options;
  return defaults;
}

function inferMemberType(model, engine) {
  if (engine === "claude" || engine === "codex") {
    return engine;
  }

  return String(model ?? "").toLowerCase().startsWith("gpt-") ? "codex" : "claude";
}

function normalizeType(type, fallback) {
  if (type === "claude" || type === "codex") {
    return type;
  }

  return inferMemberType(fallback?.model, fallback?.engine);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function createDefaultTeamSchema() {
  return cloneJson(readJsonFile(BUNDLED_TEAM_SCHEMA_PATH));
}

function deriveRole(member) {
  if (typeof member?.roleLabel?.ko === "string" && member.roleLabel.ko.trim()) {
    return member.roleLabel.ko;
  }

  return typeof member?.role === "string" ? member.role : "";
}

function buildMemberConfig(teamId, member, defaults) {
  const fallback = {
    model: typeof member?.spawnModel === "string" && member.spawnModel
      ? member.spawnModel
      : typeof member?.model === "string" ? member.model : "",
    engine: typeof member?.spawnType === "string" && member.spawnType
      ? member.spawnType
      : typeof member?.engine === "string" && member.engine ? member.engine : "",
  };
  const type = normalizeType(member?.spawnType, fallback);
  const defaultForType = defaults[type] ?? DEFAULTS[type];
  const model = typeof member?.spawnModel === "string" && member.spawnModel
    ? member.spawnModel
    : typeof member?.model === "string" && member.model ? member.model : defaultForType.model;
  const rawOptions = typeof member?.spawnOptions === "string" && member.spawnOptions
    ? member.spawnOptions
    : defaultForType.options;

  return {
    id: typeof member?.id === "string" ? member.id : "",
    emoji: typeof member?.emoji === "string" ? member.emoji : "",
    role: deriveRole(member),
    team: typeof member?.team === "string" && member.team ? member.team : teamId,
    nodeType: typeof member?.nodeType === "string" ? member.nodeType : "worker",
    type,
    model,
    options: type === "codex" ? normalizeCodexOptions(rawOptions) : normalizeWhitespace(rawOptions) || defaultForType.options,
  };
}

function flattenTeamMembers(teamSchema, defaults) {
  const members = {};

  for (const [teamId, team] of Object.entries(teamSchema?.teams ?? {})) {
    for (const member of Array.isArray(team?.members) ? team.members : []) {
      const displayName = typeof member?.name === "string" && member.name.trim() ? member.name : member?.id;
      if (!displayName) {
        continue;
      }

      members[displayName] = buildMemberConfig(teamId, member, defaults);
    }
  }

  return members;
}

function normalizeMemberConfig(name, currentValue, defaults, fallbackMember = {}) {
  const base = {
    id: typeof currentValue?.id === "string" ? currentValue.id : fallbackMember.id ?? "",
    emoji: typeof currentValue?.emoji === "string" ? currentValue.emoji : fallbackMember.emoji ?? "",
    role: typeof currentValue?.role === "string" ? currentValue.role : fallbackMember.role ?? "",
    team: typeof currentValue?.team === "string" ? currentValue.team : fallbackMember.team ?? "",
    nodeType: typeof currentValue?.nodeType === "string" ? currentValue.nodeType : fallbackMember.nodeType ?? "worker",
    model: typeof currentValue?.model === "string" && currentValue.model
      ? currentValue.model
      : fallbackMember.model ?? "",
    engine: typeof currentValue?.type === "string" ? currentValue.type : fallbackMember.type,
  };
  const type = normalizeType(currentValue?.type ?? fallbackMember.type, base);
  const defaultForType = defaults[type] ?? DEFAULTS[type];
  const model = typeof currentValue?.model === "string" && currentValue.model
    ? currentValue.model
    : fallbackMember.model || defaultForType.model;
  const rawOptions = typeof currentValue?.options === "string" && currentValue.options
    ? currentValue.options
    : fallbackMember.options || defaultForType.options;

  return {
    id: base.id,
    emoji: base.emoji,
    role: base.role,
    team: base.team,
    nodeType: base.nodeType,
    type,
    model,
    options: type === "codex" ? normalizeCodexOptions(rawOptions) : normalizeWhitespace(rawOptions) || defaultForType.options,
    name,
  };
}

function normalizeTeamConfig(raw, fallbackSchema = createDefaultTeamSchema()) {
  const defaults = normalizeConfigDefaults(raw?.defaults);
  const fallbackMembers = flattenTeamMembers(fallbackSchema, defaults);
  const members = {};
  const sourceMembers = raw?.members && typeof raw.members === "object" ? raw.members : fallbackMembers;

  for (const [name, value] of Object.entries(sourceMembers)) {
    members[name] = normalizeMemberConfig(name, value, defaults, fallbackMembers[name]);
    delete members[name].name;
  }

  for (const [name, value] of Object.entries(fallbackMembers)) {
    if (!members[name]) {
      members[name] = value;
    }
  }

  return { members, defaults };
}

function updateSchemaMemberWithConfig(member, memberConfig) {
  const nextType = normalizeType(memberConfig?.type, memberConfig);
  const defaults = DEFAULTS[nextType];
  const nextModel = typeof memberConfig?.model === "string" && memberConfig.model
    ? memberConfig.model
    : defaults.model;
  const nextOptions = typeof memberConfig?.options === "string" && memberConfig.options
    ? memberConfig.options
    : defaults.options;

  return {
    ...member,
    spawnType: nextType,
    spawnModel: nextModel,
    spawnOptions: nextType === "codex"
      ? normalizeCodexOptions(nextOptions)
      : normalizeWhitespace(nextOptions) || defaults.options,
  };
}

function applyConfigToTeamSchema(teamSchema, rawConfig) {
  const nextSchema = cloneJson(teamSchema);
  const normalizedConfig = normalizeTeamConfig(rawConfig, nextSchema);

  for (const [teamId, team] of Object.entries(nextSchema?.teams ?? {})) {
    if (!Array.isArray(team?.members)) {
      continue;
    }

    team.members = team.members.map((member) => {
      const displayName = typeof member?.name === "string" && member.name.trim() ? member.name : member?.id;
      if (!displayName) {
        return member;
      }

      const fallback = buildMemberConfig(teamId, member, normalizedConfig.defaults);
      const memberConfig = normalizedConfig.members[displayName] ?? fallback;
      return updateSchemaMemberWithConfig(member, memberConfig);
    });
  }

  return {
    schema: nextSchema,
    config: normalizeTeamConfig(null, nextSchema),
  };
}

function resolveMemberAddress(teamSchema, memberRef) {
  for (const [teamId, team] of Object.entries(teamSchema?.teams ?? {})) {
    const members = Array.isArray(team?.members) ? team.members : [];
    for (const [memberIndex, member] of members.entries()) {
      const displayName = typeof member?.name === "string" && member.name.trim() ? member.name : member?.id;
      if (displayName === memberRef || member?.id === memberRef) {
        return { teamId, memberIndex, displayName, member };
      }
    }
  }

  return null;
}

export function createDefaultTeamConfig() {
  return normalizeTeamConfig(null, createDefaultTeamSchema());
}

export class TeamConfigStore {
  constructor(configPath = DEFAULT_TEAM_JSON_PATH) {
    this.configPath = configPath;
  }

  ensure() {
    if (!existsSync(this.configPath)) {
      mkdirSync(dirname(this.configPath), { recursive: true });
      writeFileSync(this.configPath, `${JSON.stringify(createDefaultTeamSchema(), null, 2)}\n`, "utf8");
    }
  }

  readTeamSchema() {
    this.ensure();
    return readJsonFile(this.configPath);
  }

  writeTeamSchema(teamSchema) {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, `${JSON.stringify(teamSchema, null, 2)}\n`, "utf8");
  }

  getConfig() {
    return normalizeTeamConfig(null, this.readTeamSchema());
  }

  saveConfig(config) {
    const currentSchema = this.readTeamSchema();
    const { schema, config: savedConfig } = applyConfigToTeamSchema(currentSchema, config);
    this.writeTeamSchema(schema);
    return savedConfig;
  }

  resolveMemberKey(memberRef) {
    const address = resolveMemberAddress(this.readTeamSchema(), memberRef);
    return address?.displayName ?? null;
  }

  getMember(memberRef) {
    const config = this.getConfig();
    const key = this.resolveMemberKey(memberRef);
    if (!key) {
      return null;
    }

    return {
      key,
      config,
      member: config.members[key],
    };
  }

  updateMember(memberRef, patch) {
    const teamSchema = this.readTeamSchema();
    const address = resolveMemberAddress(teamSchema, memberRef);
    if (!address) {
      return null;
    }

    const config = normalizeTeamConfig(null, teamSchema);
    const current = config.members[address.displayName];
    const nextType = normalizeType(
      typeof patch?.type === "string" ? patch.type : current.type,
      current,
    );
    const defaults = config.defaults[nextType] ?? DEFAULTS[nextType];
    const nextOptions = typeof patch?.options === "string" && patch.options.trim()
      ? patch.options.trim()
      : current.options || defaults.options;
    const nextMemberConfig = {
      ...current,
      type: nextType,
      model: typeof patch?.model === "string" && patch.model.trim()
        ? patch.model.trim()
        : current.model || defaults.model,
      options: nextType === "codex" ? normalizeCodexOptions(nextOptions) : normalizeWhitespace(nextOptions) || defaults.options,
    };

    if (typeof patch?.type === "string" && (!patch?.model || !patch.model.trim())) {
      nextMemberConfig.model = defaults.model;
    }
    if (typeof patch?.type === "string" && (!patch?.options || !patch.options.trim())) {
      nextMemberConfig.options = nextType === "codex"
        ? normalizeCodexOptions(defaults.options)
        : normalizeWhitespace(defaults.options) || defaults.options;
    }

    teamSchema.teams[address.teamId].members[address.memberIndex] = updateSchemaMemberWithConfig(
      address.member,
      nextMemberConfig,
    );
    this.writeTeamSchema(teamSchema);

    const nextConfig = normalizeTeamConfig(null, teamSchema);
    return {
      key: address.displayName,
      config: nextConfig,
      member: nextConfig.members[address.displayName],
    };
  }
}
