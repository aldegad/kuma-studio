// @ts-check

export const DEFAULT_MODELS = Object.freeze({
  claude: "claude-opus-4-6",
  codex: "gpt-5.4",
});

export const DEFAULT_OPTIONS = Object.freeze({
  claude: "--dangerously-skip-permissions",
  codex: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
});

export const VALID_CODEX_REASONING_LEVELS = new Set(["low", "medium", "high", "xhigh"]);

const CODEX_REASONING_OPTION_PATTERN = /(?:^|\s)-c\s+(?:model_)?reasoning_effort=(?:"[^"]*"|'[^']*'|\S+)/u;
const CODEX_SERVICE_TIER_PATTERN = /(?:^|\s)-c\s+service_tier=(?:"[^"]*"|'[^']*'|\S+)/u;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

/**
 * @param {string} options
 * @param {RegExp[]} patterns
 * @returns {string}
 */
function stripCodexOptions(options, patterns) {
  return patterns.reduce(
    (result, pattern) => normalizeWhitespace(result.replace(pattern, " ")),
    String(options ?? ""),
  );
}

/**
 * @param {string} options
 * @param {string} setting
 * @param {string} value
 * @param {{ quote?: boolean }} [optionsConfig]
 * @returns {string}
 */
function appendCodexOption(options, setting, value, { quote = false } = {}) {
  const renderedValue = quote ? `"${value}"` : value;
  return normalizeWhitespace(`${options} -c ${setting}=${renderedValue}`);
}

/**
 * @param {string} options
 * @param {string[]} settingNames
 * @returns {string}
 */
export function readCodexOption(options, settingNames) {
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

/**
 * @param {string} options
 * @param {string} [fallbackOptions]
 * @returns {string}
 */
export function normalizeCodexOptions(options, fallbackOptions = DEFAULT_OPTIONS.codex) {
  const fallback = normalizeWhitespace(fallbackOptions) || DEFAULT_OPTIONS.codex;
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

/**
 * @param {string} teamId
 * @param {any} team
 * @returns {{ ko: string, en: string }}
 */
export function normalizeTeamName(teamId, team) {
  const ko = typeof team?.name === "string" && team.name.trim() ? team.name : teamId;
  const en = typeof team?.nameEn === "string" && team.nameEn.trim() ? team.nameEn : ko;
  return { ko, en };
}

/**
 * @param {any} member
 * @returns {{ ko: string, en: string }}
 */
export function normalizeRoleLabel(member) {
  const ko = typeof member?.roleLabel?.ko === "string" && member.roleLabel.ko.trim()
    ? member.roleLabel.ko
    : String(member?.role ?? "");
  const en = typeof member?.roleLabel?.en === "string" && member.roleLabel.en.trim()
    ? member.roleLabel.en
    : String(member?.role ?? "");
  return { ko, en };
}

/**
 * @param {any} member
 * @returns {"claude" | "codex"}
 */
export function normalizeEngine(member) {
  if (member?.spawnType === "claude" || member?.spawnType === "codex") {
    return member.spawnType;
  }
  return String(member?.spawnModel ?? "").startsWith("gpt-") ? "codex" : "claude";
}

/**
 * @param {any} member
 * @param {"claude" | "codex"} engine
 * @returns {string}
 */
export function normalizeModel(member, engine) {
  if (typeof member?.spawnModel === "string" && member.spawnModel.trim()) {
    return member.spawnModel.trim();
  }

  return DEFAULT_MODELS[engine] ?? DEFAULT_MODELS.claude;
}

/**
 * @param {any} member
 * @param {"claude" | "codex"} engine
 * @returns {string}
 */
export function normalizeOptions(member, engine) {
  const raw = typeof member?.spawnOptions === "string" && member.spawnOptions.trim()
    ? member.spawnOptions
    : DEFAULT_OPTIONS[engine] ?? DEFAULT_OPTIONS.claude;

  if (engine === "codex") {
    return normalizeCodexOptions(raw, DEFAULT_OPTIONS.codex);
  }

  return normalizeWhitespace(raw) || DEFAULT_OPTIONS.claude;
}

/**
 * @param {"claude" | "codex"} engine
 * @param {string} options
 * @returns {string | null}
 */
export function deriveEffort(engine, options) {
  if (engine !== "codex") {
    return null;
  }

  const reasoning = readCodexOption(options, ["model_reasoning_effort", "reasoning_effort"]).toLowerCase();
  return VALID_CODEX_REASONING_LEVELS.has(reasoning) ? reasoning : null;
}

/**
 * @param {"claude" | "codex"} engine
 * @param {string} options
 * @returns {string | null}
 */
export function deriveServiceTier(engine, options) {
  if (engine !== "codex") {
    return null;
  }

  return readCodexOption(options, ["service_tier"]) || null;
}

/**
 * @param {any} point
 * @returns {{ x: number, y: number }}
 */
export function normalizeOfficePoint(point) {
  return {
    x: typeof point?.x === "number" ? point.x : 220,
    y: typeof point?.y === "number" ? point.y : 160,
  };
}

/**
 * @param {any} team
 * @returns {{ origin: { x: number, y: number }, cols: number, hasSofa: boolean, zoneColor: string }}
 */
export function normalizeOffice(team) {
  return {
    origin: normalizeOfficePoint(team?.office?.origin),
    cols: typeof team?.office?.cols === "number" && team.office.cols > 0 ? team.office.cols : 2,
    hasSofa: team?.office?.hasSofa !== false,
    zoneColor: typeof team?.office?.zoneColor === "string" && team.office.zoneColor.trim()
      ? team.office.zoneColor
      : "rgba(107, 114, 128, 0.04)",
  };
}

/**
 * @param {any} team
 * @returns {boolean}
 */
export function isDeprecatedTeam(team) {
  return team?.deprecated === true || (typeof team?.aliasFor === "string" && team.aliasFor.trim().length > 0);
}

/**
 * @param {string} teamId
 * @param {any} team
 * @returns {{
 *   id: string,
 *   name: { ko: string, en: string },
 *   pm: string | null,
 *   skill: string,
 *   office: { origin: { x: number, y: number }, cols: number, hasSofa: boolean, zoneColor: string },
 *   deprecated: boolean,
 *   aliasFor: string | null,
 * }}
 */
export function normalizeTeam(teamId, team) {
  return {
    id: teamId,
    name: normalizeTeamName(teamId, team),
    pm: typeof team?.leadId === "string" && team.leadId ? team.leadId : null,
    skill: typeof team?.skill === "string" ? team.skill : "",
    office: normalizeOffice(team),
    deprecated: team?.deprecated === true,
    aliasFor: typeof team?.aliasFor === "string" && team.aliasFor.trim() ? team.aliasFor.trim() : null,
  };
}

/**
 * @param {string} teamId
 * @param {any} member
 * @returns {{
 *   id: string,
 *   name: { ko: string, en: string },
 *   animal: { ko: string, en: string },
 *   emoji: string,
 *   model: string,
 *   engine: "claude" | "codex",
 *   options: string,
 *   effort: string | null,
 *   serviceTier: string | null,
 *   team: string,
 *   nodeType: string,
 *   parentId: string | null,
 *   role: { ko: string, en: string },
 *   roleId: string,
 *   skills: string[],
 *   capabilities: string[],
 *   parallel: boolean,
 *   image: string,
 *   defaultSurface: string | null,
 *   defaultQa: string | null,
 * }}
 */
export function normalizeTeamMember(teamId, member) {
  const engine = normalizeEngine(member);
  const model = normalizeModel(member, engine);
  const options = normalizeOptions(member, engine);

  return {
    id: typeof member?.id === "string" ? member.id : "",
    name: {
      ko: typeof member?.name === "string" ? member.name : "",
      en: typeof member?.nameEn === "string" && member.nameEn.trim() ? member.nameEn : String(member?.id ?? ""),
    },
    animal: {
      ko: typeof member?.animalKo === "string" ? member.animalKo : "",
      en: typeof member?.animalEn === "string" ? member.animalEn : "",
    },
    emoji: typeof member?.emoji === "string" ? member.emoji : "",
    model,
    engine,
    options,
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
    defaultSurface: typeof member?.defaultSurface === "string" && member.defaultSurface.trim()
      ? member.defaultSurface.trim()
      : null,
    defaultQa: typeof member?.defaultQa === "string" && member.defaultQa.trim()
      ? member.defaultQa.trim()
      : null,
  };
}

/**
 * @param {any} rawTeamJson
 * @returns {{
 *   teams: ReturnType<typeof normalizeTeam>[],
 *   members: ReturnType<typeof normalizeTeamMember>[],
 *   allTeams: ReturnType<typeof normalizeTeam>[],
 * }}
 */
export function normalizeAllTeams(rawTeamJson) {
  const teamEntries = Object.entries(rawTeamJson?.teams ?? {});
  const allTeams = teamEntries.map(([teamId, team]) => normalizeTeam(teamId, team));
  const teams = allTeams.filter((team) => !isDeprecatedTeam(team));
  const members = teamEntries.flatMap(([teamId, team]) =>
    Array.isArray(team?.members)
      ? team.members.map((member) => normalizeTeamMember(teamId, member))
      : [],
  );

  return { teams, members, allTeams };
}

/**
 * @param {{ members: ReturnType<typeof normalizeTeamMember>[] }} data
 * @param {string} name
 * @returns {ReturnType<typeof normalizeTeamMember> | null}
 */
export function findMemberByDisplayName(data, name) {
  const query = normalizeWhitespace(name);
  if (!query) {
    return null;
  }

  return data.members.find((member) => member.name.ko === query) ?? null;
}

/**
 * @param {ReturnType<typeof normalizeTeamMember>} member
 * @param {string} query
 * @param {string} strippedQuery
 * @param {string} loweredQuery
 * @param {string} loweredStripped
 * @returns {number}
 */
function scoreMemberQuery(member, query, strippedQuery, loweredQuery, loweredStripped) {
  const label = `${member.emoji} ${member.name.ko}`.trim();
  const normalizedLabel = label.toLowerCase();
  const normalizedName = member.name.ko.toLowerCase();
  const normalizedId = member.id.toLowerCase();
  const normalizedEmoji = member.emoji.toLowerCase();

  if (query === label) return 100;
  if (query === member.name.ko) return 95;
  if (query === member.id) return 90;
  if (query === member.emoji) return 85;
  if (strippedQuery === member.name.ko) return 80;
  if (loweredQuery === normalizedLabel) return 75;
  if (loweredQuery === normalizedName) return 70;
  if (loweredQuery === normalizedId) return 65;
  if (loweredQuery === normalizedEmoji) return 60;
  if (loweredStripped === normalizedName) return 55;
  if (normalizedLabel.includes(loweredQuery) && loweredQuery) return 40;
  if (normalizedName.includes(loweredStripped) && loweredStripped) return 35;
  return -1;
}

/**
 * @param {{ members: ReturnType<typeof normalizeTeamMember>[] }} data
 * @param {string} rawQuery
 * @returns {ReturnType<typeof normalizeTeamMember> | null}
 */
export function findMemberByQuery(data, rawQuery) {
  const query = normalizeWhitespace(rawQuery);
  if (!query) {
    return null;
  }

  const strippedQuery = query.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || query;
  const loweredQuery = query.toLowerCase();
  const loweredStripped = strippedQuery.toLowerCase();

  const match = data.members
    .map((member) => ({
      member,
      score: scoreMemberQuery(member, query, strippedQuery, loweredQuery, loweredStripped),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)[0];

  return match?.member ?? null;
}

/**
 * @param {ReturnType<typeof normalizeTeamMember>} member
 * @returns {number}
 */
function getSurfaceSortValue(member) {
  const surface = typeof member.defaultSurface === "string" ? member.defaultSurface : "";
  const numeric = Number.parseInt(surface.replace(/^surface:/u, ""), 10);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

/**
 * @param {{ members: ReturnType<typeof normalizeTeamMember>[] }} data
 * @returns {string[]}
 */
export function listBootstrapSystemMembers(data) {
  return data.members
    .filter((member) => member.team === "system")
    .slice()
    .sort((left, right) => getSurfaceSortValue(left) - getSurfaceSortValue(right) || left.name.ko.localeCompare(right.name.ko))
    .map((member) => member.name.ko);
}

/**
 * @param {{ members: ReturnType<typeof normalizeTeamMember>[] }} data
 * @returns {string[]}
 */
export function listProjectSpawnMembers(data) {
  return data.members
    .filter((member) => member.team !== "system")
    .map((member) => member.name.ko);
}
