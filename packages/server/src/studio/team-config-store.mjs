import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

import { getMembersById } from "../team-metadata.mjs";

export const DEFAULT_TEAM_CONFIG_PATH = `${homedir()}/.kuma/team-config.json`;

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

function inferMemberType(model) {
  return String(model ?? "").toLowerCase().startsWith("gpt-") ? "codex" : "claude";
}

function buildMemberConfig(member) {
  const type = inferMemberType(member?.model);
  const defaults = DEFAULTS[type];
  const options = type === "codex" ? normalizeCodexOptions(defaults.options) : defaults.options;

  return {
    id: member.id,
    emoji: typeof member?.emoji === "string" ? member.emoji : "",
    role: typeof member?.role?.ko === "string" ? member.role.ko : "",
    team: typeof member?.team === "string" ? member.team : "",
    nodeType: typeof member?.nodeType === "string" ? member.nodeType : "worker",
    type,
    model: typeof member?.model === "string" && member.model ? member.model : defaults.model,
    options,
  };
}

export function createDefaultTeamConfig() {
  const membersById = getMembersById();
  const members = {};

  for (const member of membersById.values()) {
    const displayName = member?.name?.ko;
    if (typeof displayName !== "string" || !displayName) {
      continue;
    }

    members[displayName] = buildMemberConfig(member);
  }

  return {
    members,
    defaults: {
      ...DEFAULTS,
      codex: {
        ...DEFAULTS.codex,
        options: normalizeCodexOptions(DEFAULTS.codex.options),
      },
    },
  };
}

function normalizeType(type, defaults) {
  if (type === "claude" || type === "codex") {
    return type;
  }

  return inferMemberType(defaults?.model);
}

function normalizeMemberConfig(name, currentValue, defaults) {
  const nextDefaults = defaults ?? DEFAULTS;
  const currentType = normalizeType(currentValue?.type, currentValue ?? nextDefaults.claude);
  const defaultForType = nextDefaults[currentType] ?? DEFAULTS[currentType];
  const options = typeof currentValue?.options === "string" && currentValue.options
    ? currentValue.options
    : defaultForType.options;

  return {
    id: typeof currentValue?.id === "string" ? currentValue.id : "",
    emoji: typeof currentValue?.emoji === "string" ? currentValue.emoji : "",
    role: typeof currentValue?.role === "string" ? currentValue.role : "",
    team: typeof currentValue?.team === "string" ? currentValue.team : "",
    nodeType: typeof currentValue?.nodeType === "string" ? currentValue.nodeType : "worker",
    type: currentType,
    model: typeof currentValue?.model === "string" && currentValue.model ? currentValue.model : defaultForType.model,
    options: currentType === "codex" ? normalizeCodexOptions(options) : options,
    name,
  };
}

function normalizeTeamConfig(raw) {
  const fallback = createDefaultTeamConfig();
  const defaults = {
    claude: {
      ...DEFAULTS.claude,
      ...(raw?.defaults?.claude ?? {}),
    },
    codex: {
      ...DEFAULTS.codex,
      ...(raw?.defaults?.codex ?? {}),
    },
  };
  defaults.codex.options = normalizeCodexOptions(defaults.codex.options);

  const members = {};
  const sourceMembers = raw?.members && typeof raw.members === "object" ? raw.members : fallback.members;

  for (const [name, value] of Object.entries(sourceMembers)) {
    members[name] = normalizeMemberConfig(name, value, defaults);
    delete members[name].name;
  }

  return { members, defaults };
}

export class TeamConfigStore {
  constructor(configPath = DEFAULT_TEAM_CONFIG_PATH) {
    this.configPath = configPath;
  }

  ensure() {
    if (!existsSync(this.configPath)) {
      mkdirSync(dirname(this.configPath), { recursive: true });
      writeFileSync(this.configPath, `${JSON.stringify(createDefaultTeamConfig(), null, 2)}\n`, "utf8");
    }
  }

  getConfig() {
    this.ensure();
    const raw = JSON.parse(readFileSync(this.configPath, "utf8"));
    return normalizeTeamConfig(raw);
  }

  saveConfig(config) {
    const normalized = normalizeTeamConfig(config);
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }

  resolveMemberKey(memberRef) {
    const config = this.getConfig();
    if (config.members[memberRef]) {
      return memberRef;
    }

    for (const [name, value] of Object.entries(config.members)) {
      if (value.id === memberRef) {
        return name;
      }
    }

    return null;
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
    const config = this.getConfig();
    const key = this.resolveMemberKey(memberRef);
    if (!key) {
      return null;
    }

    const current = config.members[key];
    const nextType = normalizeType(
      typeof patch?.type === "string" ? patch.type : current.type,
      current,
    );
    const defaults = config.defaults[nextType] ?? DEFAULTS[nextType];
    const nextOptions = typeof patch?.options === "string" && patch.options.trim()
      ? patch.options.trim()
      : current.options || defaults.options;

    config.members[key] = {
      ...current,
      type: nextType,
      model: typeof patch?.model === "string" && patch.model.trim() ? patch.model.trim() : current.model || defaults.model,
      options: nextType === "codex" ? normalizeCodexOptions(nextOptions) : nextOptions,
    };

    if (typeof patch?.type === "string" && (!patch?.model || !patch.model.trim())) {
      config.members[key].model = defaults.model;
    }
    if (typeof patch?.type === "string" && (!patch?.options || !patch.options.trim())) {
      config.members[key].options = nextType === "codex"
        ? normalizeCodexOptions(defaults.options)
        : defaults.options;
    }

    return {
      key,
      config: this.saveConfig(config),
      member: config.members[key],
    };
  }
}
