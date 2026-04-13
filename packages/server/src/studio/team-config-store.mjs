import fs, { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

import {
  MODEL_CATALOG,
  getModelCatalogEntry,
  listModelCatalogByType,
  normalizeModelCatalog,
} from "../../../shared/model-catalog.mjs";

export const DEFAULT_TEAM_JSON_PATH = `${homedir()}/.kuma/team.json`;

const BUNDLED_TEAM_SCHEMA_PATH = new URL("../../../shared/team.json", import.meta.url);
const TEAM_CONFIG_DIFF_FIELDS = [
  "spawnType",
  "spawnModel",
  "spawnOptions",
  "modelCatalogId",
];

const CODEX_BASE_OPTIONS = "--dangerously-bypass-approvals-and-sandbox";
const VALID_CODEX_REASONING_LEVELS = new Set(["low", "medium", "high", "xhigh"]);
const CODEX_REASONING_OPTION_PATTERN = /(?:^|\s)-c\s+(?:model_)?reasoning_effort=(?:"[^"]*"|'[^']*'|\S+)/u;
const CODEX_SERVICE_TIER_PATTERN = /(?:^|\s)-c\s+service_tier=(?:"[^"]*"|'[^']*'|\S+)/u;

function normalizeWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function readCodexOption(options, settingNames) {
  const normalized = normalizeWhitespace(options);
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

function stripCodexOptions(options, patterns) {
  return patterns.reduce(
    (result, pattern) => normalizeWhitespace(result.replace(pattern, " ")),
    String(options ?? ""),
  );
}

function appendCodexOption(options, setting, value, { quote = false } = {}) {
  const renderedValue = quote ? `"${value}"` : value;
  return normalizeWhitespace(`${options} -c ${setting}=${renderedValue}`);
}

const CLAUDE_DEFAULT_OPTIONS = "--dangerously-skip-permissions";
const DEFAULT_MODEL_CATALOG_IDS = Object.freeze({
  claude: "claude-opus-4-6-high",
  codex: "gpt-5.4-xhigh-fast",
});
const PREFERRED_MODEL_CATALOG_IDS_BY_MODEL = Object.freeze({
  "claude-opus-4-6": "claude-opus-4-6-high",
  "claude-sonnet-4-6": "claude-sonnet-4-6-high",
  "gpt-5.4": "gpt-5.4-xhigh-fast",
  "gpt-5.4-mini": "gpt-5.4-mini-xhigh-fast",
});

function getModelCatalogEntries(catalog = MODEL_CATALOG) {
  const normalized = normalizeModelCatalog(catalog);
  return normalized.length > 0 ? normalized : MODEL_CATALOG;
}

function requireModelCatalogEntry(id, catalog = MODEL_CATALOG) {
  const entry = getModelCatalogEntry(id, getModelCatalogEntries(catalog));
  if (!entry) {
    throw new Error(`Unknown model catalog entry: ${id}`);
  }
  return entry;
}

function getCatalogFallbackIdForModel(type, model = "", catalog = MODEL_CATALOG) {
  const entries = getModelCatalogEntries(catalog);
  const normalizedModel = normalizeWhitespace(model);
  const defaultId = DEFAULT_MODEL_CATALOG_IDS[type];

  if (!normalizedModel) {
    return getModelCatalogEntry(defaultId, entries)?.id ?? entries.find((entry) => entry.type === type)?.id ?? defaultId;
  }

  const preferredId = PREFERRED_MODEL_CATALOG_IDS_BY_MODEL[normalizedModel];
  const preferredEntry = preferredId ? getModelCatalogEntry(preferredId, entries) : undefined;
  if (preferredEntry?.type === type) {
    return preferredEntry.id;
  }

  const typedEntries = listModelCatalogByType(type, entries);
  return typedEntries[0]?.id ?? defaultId;
}

function getCatalogFallbackEntry(type, model = "", catalog = MODEL_CATALOG) {
  return requireModelCatalogEntry(getCatalogFallbackIdForModel(type, model, catalog), catalog);
}

function buildOptionsFromCatalogEntry(entry) {
  const explicitOptions = normalizeWhitespace(entry?.options);
  if (entry.type !== "codex") {
    let opts = explicitOptions || CLAUDE_DEFAULT_OPTIONS;
    if (entry.effort) opts = normalizeWhitespace(`${opts} --effort ${entry.effort}`);
    return opts;
  }

  if (explicitOptions) {
    return normalizeCodexOptions(explicitOptions, CODEX_BASE_OPTIONS);
  }

  let options = CODEX_BASE_OPTIONS;
  if (entry.serviceTier) {
    options = appendCodexOption(options, "service_tier", entry.serviceTier);
  }
  if (entry.effort) {
    options = appendCodexOption(options, "model_reasoning_effort", entry.effort, { quote: true });
  }
  return normalizeWhitespace(options);
}

function createDefaults(catalog = MODEL_CATALOG) {
  const normalizedCatalog = getModelCatalogEntries(catalog);
  const claude = getCatalogFallbackEntry("claude", "", normalizedCatalog);
  const codex = getCatalogFallbackEntry("codex", "", normalizedCatalog);

  return {
    claude: {
      model: claude.model,
      options: buildOptionsFromCatalogEntry(claude),
      modelCatalogId: claude.id,
    },
    codex: {
      model: codex.model,
      options: buildOptionsFromCatalogEntry(codex),
      modelCatalogId: codex.id,
    },
  };
}

const DEFAULTS = Object.freeze(createDefaults(MODEL_CATALOG));

function normalizeCodexOptions(options, fallbackOptions = DEFAULTS.codex.options) {
  const fallback = normalizeWhitespace(fallbackOptions) || DEFAULTS.codex.options;
  const normalizedInput = normalizeWhitespace(options);
  const reasoningFromInput = readCodexOption(normalizedInput, ["model_reasoning_effort", "reasoning_effort"]);
  const fallbackReasoning = readCodexOption(fallback, ["model_reasoning_effort", "reasoning_effort"]) || "xhigh";
  const reasoning = VALID_CODEX_REASONING_LEVELS.has(reasoningFromInput)
    ? reasoningFromInput
    : fallbackReasoning;
  const serviceTier = readCodexOption(normalizedInput, ["service_tier"])
    || readCodexOption(fallback, ["service_tier"])
    || "fast";
  const baseOptions = stripCodexOptions(
    normalizedInput || fallback,
    [CODEX_REASONING_OPTION_PATTERN, CODEX_SERVICE_TIER_PATTERN],
  );

  return appendCodexOption(
    appendCodexOption(baseOptions, "service_tier", serviceTier),
    "model_reasoning_effort",
    reasoning,
    { quote: true },
  );
}

function normalizeConfigDefaults(rawDefaults, catalog = MODEL_CATALOG) {
  const defaultCatalog = createDefaults(catalog);
  const rawClaude = {
    ...defaultCatalog.claude,
    ...(rawDefaults?.claude ?? {}),
  };
  const rawCodex = {
    ...defaultCatalog.codex,
    ...(rawDefaults?.codex ?? {}),
  };

  const claude = normalizeResolvedModelConfig(
    "claude",
    rawClaude.model,
    rawClaude.options,
    defaultCatalog.claude,
    rawClaude.modelCatalogId,
    catalog,
  );
  const codex = normalizeResolvedModelConfig(
    "codex",
    rawCodex.model,
    rawCodex.options,
    defaultCatalog.codex,
    rawCodex.modelCatalogId,
    catalog,
  );

  return { claude, codex };
}

function inferMemberType(model) {
  return String(model ?? "").toLowerCase().startsWith("gpt-") ? "codex" : "claude";
}

function normalizeType(type, fallback) {
  if (type === "claude" || type === "codex") {
    return type;
  }

  return inferMemberType(fallback?.model);
}

export function resolveModelCatalogEntry(type, model, options = "", catalog = MODEL_CATALOG) {
  if (type !== "claude" && type !== "codex") {
    return undefined;
  }

  const normalizedCatalog = getModelCatalogEntries(catalog);
  const normalizedModel = normalizeWhitespace(model);
  if (!normalizedModel) {
    return getCatalogFallbackEntry(type, "", normalizedCatalog);
  }

  const directEntry = getModelCatalogEntry(normalizedModel, normalizedCatalog);
  if (directEntry?.type === type) {
    return directEntry;
  }

  if (type === "claude") {
    return listModelCatalogByType(type, normalizedCatalog).find((entry) => entry.model === normalizedModel);
  }

  const fallbackEntry = getCatalogFallbackEntry(type, normalizedModel, normalizedCatalog);
  const normalizedOptions = normalizeCodexOptions(options, buildOptionsFromCatalogEntry(fallbackEntry));
  const effort = readCodexOption(normalizedOptions, ["model_reasoning_effort", "reasoning_effort"]);
  const serviceTier = readCodexOption(normalizedOptions, ["service_tier"]) || "default";

  return listModelCatalogByType(type, normalizedCatalog).find(
    (entry) =>
      entry.model === normalizedModel
      && entry.effort === effort
      && (entry.serviceTier ?? "default") === serviceTier,
  );
}

function normalizeResolvedModelConfig(type, model, options, fallback, modelCatalogId = "", catalog = MODEL_CATALOG) {
  const defaults = createDefaults(catalog);
  const defaultForType = fallback ?? defaults[type];
  const normalizedCatalog = getModelCatalogEntries(catalog);
  const explicitCatalogId = normalizeWhitespace(modelCatalogId) || normalizeWhitespace(model);
  const explicitCatalogEntry = getModelCatalogEntry(explicitCatalogId, normalizedCatalog);
  const requestedModel = explicitCatalogId || normalizeWhitespace(model) || defaultForType.model;
  const explicitCatalogSelection = explicitCatalogEntry?.type === type ? explicitCatalogEntry : undefined;
  const catalogEntry = explicitCatalogSelection ?? resolveModelCatalogEntry(type, requestedModel, options, normalizedCatalog);
  const fallbackOptions = catalogEntry ? buildOptionsFromCatalogEntry(catalogEntry) : defaultForType.options;
  const rawOptions = explicitCatalogSelection ? "" : options;

  return {
    model: catalogEntry?.model ?? requestedModel,
    options: type === "codex"
      ? normalizeCodexOptions(rawOptions, fallbackOptions)
      : normalizeWhitespace(rawOptions) || fallbackOptions,
    modelCatalogId: catalogEntry?.id ?? "",
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeComparableValue(value) {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (value == null) {
    return "";
  }

  return value;
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

function buildMemberConfig(teamId, member, defaults, modelCatalog = MODEL_CATALOG) {
  const fallback = {
    model: typeof member?.spawnModel === "string" && member.spawnModel
      ? member.spawnModel
      : "",
  };
  const type = normalizeType(member?.spawnType, fallback);
  const defaultForType = defaults[type] ?? createDefaults(modelCatalog)[type];
  const resolvedModel = normalizeResolvedModelConfig(
    type,
    typeof member?.spawnModel === "string" ? member.spawnModel : "",
    typeof member?.spawnOptions === "string" ? member.spawnOptions : "",
    defaultForType,
    typeof member?.modelCatalogId === "string" ? member.modelCatalogId : "",
    modelCatalog,
  );

  return {
    id: typeof member?.id === "string" ? member.id : "",
    emoji: typeof member?.emoji === "string" ? member.emoji : "",
    role: deriveRole(member),
    team: typeof member?.team === "string" && member.team ? member.team : teamId,
    nodeType: typeof member?.nodeType === "string" ? member.nodeType : "worker",
    type,
    ...resolvedModel,
  };
}

function flattenTeamMembers(teamSchema, defaults, modelCatalog = MODEL_CATALOG) {
  const members = {};

  for (const [teamId, team] of Object.entries(teamSchema?.teams ?? {})) {
    for (const member of Array.isArray(team?.members) ? team.members : []) {
      const displayName = typeof member?.name === "string" && member.name.trim() ? member.name : member?.id;
      if (!displayName) {
        continue;
      }

      members[displayName] = buildMemberConfig(teamId, member, defaults, modelCatalog);
    }
  }

  return members;
}

function normalizeMemberConfig(name, currentValue, defaults, fallbackMember = {}, modelCatalog = MODEL_CATALOG) {
  const base = {
    id: typeof currentValue?.id === "string" ? currentValue.id : fallbackMember.id ?? "",
    emoji: typeof currentValue?.emoji === "string" ? currentValue.emoji : fallbackMember.emoji ?? "",
    role: typeof currentValue?.role === "string" ? currentValue.role : fallbackMember.role ?? "",
    team: typeof currentValue?.team === "string" ? currentValue.team : fallbackMember.team ?? "",
    nodeType: typeof currentValue?.nodeType === "string" ? currentValue.nodeType : fallbackMember.nodeType ?? "worker",
    model: typeof currentValue?.model === "string" && currentValue.model
      ? currentValue.model
      : fallbackMember.model ?? "",
  };
  const type = normalizeType(currentValue?.type ?? fallbackMember.type, base);
  const defaultForType = defaults[type] ?? createDefaults(modelCatalog)[type];
  const resolvedModel = normalizeResolvedModelConfig(
    type,
    typeof currentValue?.model === "string" && currentValue.model
      ? currentValue.model
      : fallbackMember.model || defaultForType.model,
    typeof currentValue?.options === "string" && currentValue.options
      ? currentValue.options
      : fallbackMember.options || defaultForType.options,
    defaultForType,
    typeof currentValue?.modelCatalogId === "string" && currentValue.modelCatalogId
      ? currentValue.modelCatalogId
      : fallbackMember.modelCatalogId || "",
    modelCatalog,
  );

  return {
    id: base.id,
    emoji: base.emoji,
    role: base.role,
    team: base.team,
    nodeType: base.nodeType,
    type,
    ...resolvedModel,
    name,
  };
}

function normalizeTeamConfig(raw, fallbackSchema = createDefaultTeamSchema()) {
  const modelCatalog = getModelCatalogEntries(raw?.modelCatalog ?? fallbackSchema?.modelCatalog ?? MODEL_CATALOG);
  const defaults = normalizeConfigDefaults(raw?.defaults, modelCatalog);
  const fallbackMembers = flattenTeamMembers(fallbackSchema, defaults, modelCatalog);
  const members = {};
  const sourceMembers = raw?.members && typeof raw.members === "object" ? raw.members : fallbackMembers;

  for (const [name, value] of Object.entries(sourceMembers)) {
    members[name] = normalizeMemberConfig(name, value, defaults, fallbackMembers[name], modelCatalog);
    delete members[name].name;
  }

  for (const [name, value] of Object.entries(fallbackMembers)) {
    if (!members[name]) {
      members[name] = value;
    }
  }

  return { members, defaults, modelCatalog };
}

function updateSchemaMemberWithConfig(member, memberConfig, modelCatalog = MODEL_CATALOG) {
  const nextType = normalizeType(memberConfig?.type, memberConfig);
  const defaults = createDefaults(modelCatalog)[nextType];
  const resolvedModel = normalizeResolvedModelConfig(
    nextType,
    typeof memberConfig?.model === "string" && memberConfig.model
      ? memberConfig.model
      : defaults.model,
    typeof memberConfig?.options === "string" && memberConfig.options
      ? memberConfig.options
      : defaults.options,
    defaults,
    typeof memberConfig?.modelCatalogId === "string" && memberConfig.modelCatalogId
      ? memberConfig.modelCatalogId
      : "",
    modelCatalog,
  );

  return {
    ...member,
    modelCatalogId: resolvedModel.modelCatalogId,
    spawnType: nextType,
    spawnModel: resolvedModel.model,
    spawnOptions: resolvedModel.options,
  };
}

function applyConfigToTeamSchema(teamSchema, rawConfig) {
  const nextSchema = cloneJson(teamSchema);
  const normalizedConfig = normalizeTeamConfig(rawConfig, nextSchema);
  nextSchema.modelCatalog = normalizedConfig.modelCatalog;

  for (const [teamId, team] of Object.entries(nextSchema?.teams ?? {})) {
    if (!Array.isArray(team?.members)) {
      continue;
    }

    team.members = team.members.map((member) => {
      const displayName = typeof member?.name === "string" && member.name.trim() ? member.name : member?.id;
      if (!displayName) {
        return member;
      }

      const fallback = buildMemberConfig(teamId, member, normalizedConfig.defaults, normalizedConfig.modelCatalog);
      const memberConfig = normalizedConfig.members[displayName] ?? fallback;
      return updateSchemaMemberWithConfig(member, memberConfig, normalizedConfig.modelCatalog);
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

function snapshotTeamSchemaMembers(teamSchema) {
  const members = {};

  for (const [teamId, team] of Object.entries(teamSchema?.teams ?? {})) {
    for (const member of Array.isArray(team?.members) ? team.members : []) {
      const memberId = typeof member?.id === "string" ? member.id.trim() : "";
      if (!memberId) {
        continue;
      }

      members[memberId] = {
        id: memberId,
        name: typeof member?.name === "string" ? member.name : "",
        emoji: typeof member?.emoji === "string" ? member.emoji : "",
        team: typeof member?.team === "string" && member.team ? member.team : teamId,
        modelCatalogId: normalizeComparableValue(member?.modelCatalogId),
        spawnType: normalizeComparableValue(member?.spawnType),
        spawnModel: normalizeComparableValue(member?.spawnModel),
        spawnOptions: normalizeComparableValue(member?.spawnOptions),
      };
    }
  }

  return members;
}

export function diffTeamConfig(prevTeamSchema, nextTeamSchema) {
  const previousMembers = snapshotTeamSchemaMembers(prevTeamSchema);
  const nextMembers = snapshotTeamSchemaMembers(nextTeamSchema);
  const previousIds = new Set(Object.keys(previousMembers));
  const nextIds = new Set(Object.keys(nextMembers));

  const added = Array.from(nextIds)
    .filter((id) => !previousIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  const removed = Array.from(previousIds)
    .filter((id) => !nextIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  const updated = Array.from(nextIds)
    .filter((id) => previousIds.has(id))
    .filter((id) =>
      TEAM_CONFIG_DIFF_FIELDS.some(
        (field) => previousMembers[id]?.[field] !== nextMembers[id]?.[field],
      )
    )
    .sort((left, right) => left.localeCompare(right));

  return { added, removed, updated };
}

/**
 * Watch the live team.json file and emit debounced member diffs when it changes.
 * @param {{ configPath?: string, debounceMs?: number, onChange?: (payload: { configPath: string, changedIds: string[], diff: ReturnType<typeof diffTeamConfig>, previousMembers: Record<string, object>, currentMembers: Record<string, object>, previousConfig: object, nextConfig: object }) => void | Promise<void>, onError?: (error: unknown) => void }} [options]
 * @returns {{ close(): void }}
 */
export function watchTeamConfig(options = {}) {
  const {
    configPath = DEFAULT_TEAM_JSON_PATH,
    debounceMs = 500,
    onChange,
    onError,
  } = options;

  if (!existsSync(configPath)) {
    return { close() {} };
  }

  let previousConfig = readJsonFile(configPath);
  let debounceTimer = null;
  let closed = false;
  let watcher = null;

  const scheduleRefresh = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const previousSnapshot = previousConfig;
        const nextConfig = readJsonFile(configPath);
        const diff = diffTeamConfig(previousSnapshot, nextConfig);
        const changedIds = [...diff.added, ...diff.removed, ...diff.updated];
        const previousMembers = snapshotTeamSchemaMembers(previousSnapshot);
        const currentMembers = snapshotTeamSchemaMembers(nextConfig);
        previousConfig = nextConfig;

        if (changedIds.length === 0) {
          return;
        }

        await onChange?.({
          configPath,
          changedIds,
          diff,
          previousMembers,
          currentMembers,
          previousConfig: previousSnapshot,
          nextConfig,
        });
      } catch (error) {
        onError?.(error);
      }
    }, debounceMs);
  };

  try {
    watcher = fs.watch(configPath, { persistent: true }, () => {
      if (closed) {
        return;
      }
      scheduleRefresh();
    });
  } catch (error) {
    onError?.(error);
    return { close() {} };
  }

  return {
    close() {
      closed = true;
      clearTimeout(debounceTimer);
      watcher?.close();
    },
  };
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
    const defaults = config.defaults[nextType] ?? createDefaults(config.modelCatalog)[nextType];
    const nextModel = typeof patch?.modelCatalogId === "string" && patch.modelCatalogId.trim()
      ? patch.modelCatalogId.trim()
      : typeof patch?.model === "string" && patch.model.trim()
        ? patch.model.trim()
        : typeof patch?.type === "string"
          ? defaults.modelCatalogId || defaults.model
          : current.modelCatalogId || current.model || defaults.model;
    const nextOptions = typeof patch?.options === "string" && patch.options.trim()
      ? patch.options.trim()
      : typeof patch?.type === "string"
        ? defaults.options
        : current.options || defaults.options;
    const nextMemberConfig = {
      ...current,
      type: nextType,
      ...normalizeResolvedModelConfig(nextType, nextModel, nextOptions, defaults, "", config.modelCatalog),
    };

    teamSchema.teams[address.teamId].members[address.memberIndex] = updateSchemaMemberWithConfig(
      address.member,
      nextMemberConfig,
      config.modelCatalog,
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
