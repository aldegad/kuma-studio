#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  DEFAULT_MODELS,
  DEFAULT_OPTIONS,
  findMemberByDisplayName,
  findMemberByQuery,
  listBootstrapSystemMembers,
  listProjectSpawnTeams,
  listProjectSpawnMembers,
  listTeamMembers,
  normalizeAllTeams,
  normalizeWhitespace,
} from "./team-normalizer.mjs";

/**
 * @param {string} path
 * @returns {any}
 */
function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {string} configPath
 * @returns {ReturnType<typeof normalizeAllTeams>}
 */
function loadNormalizedTeamData(configPath) {
  return normalizeAllTeams(readJsonFile(configPath));
}

/**
 * @param {ReturnType<typeof normalizeAllTeams>["members"][number] | null | undefined} member
 * @returns {Record<string, unknown>}
 */
function toShellMember(member) {
  return {
    displayName: member?.name?.ko ?? "",
    id: member?.id ?? "",
    emoji: member?.emoji ?? "",
    role: member?.role?.ko ?? "",
    roleLabelEn: member?.role?.en ?? "",
    team: member?.team ?? "",
    nodeType: member?.nodeType ?? "",
    defaultQa: member?.defaultQa ?? "",
    qaFallback: member?.qaFallback ?? "",
    vaultDomains: Array.isArray(member?.vaultDomains) ? member.vaultDomains : [],
    defaultSurface: member?.defaultSurface ?? "",
    modelCatalogId: member?.modelCatalogId ?? "",
    type: member?.engine ?? "",
    model: member?.model ?? "",
    options: member?.options ?? "",
    skills: Array.isArray(member?.skills) ? member.skills : [],
  };
}

/**
 * @param {unknown} value
 * @returns {void}
 */
function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * @param {string} value
 * @returns {void}
 */
function writeLines(value) {
  if (!value) {
    return;
  }
  process.stdout.write(value);
  if (!value.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

/**
 * @param {string} label
 * @returns {{ name: string, emoji: string, text: string }}
 */
function parseRegistryLabel(label) {
  const text = String(label ?? "").trim();
  const emojiMatch = text.match(/^[\p{Extended_Pictographic}\uFE0F\s]+/u);
  const emoji = emojiMatch ? emojiMatch[0].replace(/\s+/gu, "").trim() : "";
  const name = text.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || text;
  return { name, emoji, text };
}

/**
 * @param {string[]} fields
 * @returns {void}
 */
function writeRecord(fields) {
  writeLines(fields.map((field) => String(field ?? "")).join("\x1f"));
}

/**
 * @param {ReturnType<typeof normalizeAllTeams>} teamData
 * @param {string} registryPath
 * @param {string} projectFilter
 * @returns {string}
 */
function buildProjectMemberLines(teamData, registryPath, projectFilter) {
  const registry = readJsonFile(registryPath);
  const membersByName = new Map(
    teamData.members.map((member) => [member.name.ko, toShellMember(member)]),
  );
  const lines = [];

  for (const [projectId, projectMembers] of Object.entries(registry ?? {})) {
    if (projectFilter && projectId !== projectFilter) {
      continue;
    }

    for (const [label, surface] of Object.entries(projectMembers ?? {})) {
      const parsed = parseRegistryLabel(label);
      if (/^(server|frontend)$/iu.test(parsed.name)) {
        continue;
      }

      const member = membersByName.get(parsed.name) ?? {
        displayName: parsed.name,
        id: parsed.name,
        emoji: parsed.emoji,
        type: "",
        team: "",
      };

      lines.push([
        projectId,
        member.displayName,
        member.id,
        member.emoji || parsed.emoji,
        member.type,
        member.team,
        String(surface ?? ""),
      ].join("\t"));
    }
  }

  return lines.join("\n");
}

const [, , command = "", ...args] = process.argv;

switch (command) {
  case "normalize-file": {
    const [configPath = ""] = args;
    writeJson(loadNormalizedTeamData(configPath));
    break;
  }
  case "normalize-stdin": {
    const raw = JSON.parse(readFileSync(0, "utf8"));
    writeJson(normalizeAllTeams(raw));
    break;
  }
  case "default-member-config": {
    const [rawType = ""] = args;
    const type = normalizeWhitespace(rawType);
    if (type !== "claude" && type !== "codex") {
      process.exit(1);
    }
    writeJson({
      type,
      model: DEFAULT_MODELS[type],
      options: DEFAULT_OPTIONS[type],
    });
    break;
  }
  case "member-json": {
    const [configPath = "", displayName = ""] = args;
    const member = findMemberByDisplayName(loadNormalizedTeamData(configPath), displayName);
    if (!member) {
      process.exit(1);
    }
    writeJson(toShellMember(member));
    break;
  }
  case "member-field": {
    const [configPath = "", displayName = "", field = ""] = args;
    const member = findMemberByDisplayName(loadNormalizedTeamData(configPath), displayName);
    if (!member) {
      process.exit(1);
    }
    const shellMember = toShellMember(member);
    process.stdout.write(`${shellMember[field] ?? ""}\n`);
    break;
  }
  case "member-exists": {
    const [configPath = "", displayName = ""] = args;
    const member = findMemberByDisplayName(loadNormalizedTeamData(configPath), displayName);
    process.exit(member ? 0 : 1);
    break;
  }
  case "resolve-member-query": {
    const [configPath = "", query = ""] = args;
    const member = findMemberByQuery(loadNormalizedTeamData(configPath), query);
    if (!member) {
      process.exit(1);
    }
    writeJson(toShellMember(member));
    break;
  }
  case "resolve-launch-record": {
    const [configPath = "", displayName = "", rawType = ""] = args;
    const member = findMemberByDisplayName(loadNormalizedTeamData(configPath), displayName);
    if (member) {
      const shellMember = toShellMember(member);
      writeRecord([
        shellMember.displayName,
        shellMember.type,
        shellMember.model,
        shellMember.options,
        shellMember.emoji,
        shellMember.skills[0] ?? "",
        shellMember.roleLabelEn,
        shellMember.nodeType,
      ]);
      break;
    }

    const type = normalizeWhitespace(rawType);
    if (type !== "claude" && type !== "codex") {
      process.exit(1);
    }

    writeRecord([
      "",
      type,
      DEFAULT_MODELS[type],
      DEFAULT_OPTIONS[type],
      "",
      "",
      "",
      "worker",
    ]);
    break;
  }
  case "list-bootstrap-system-members": {
    const [configPath = ""] = args;
    writeLines(listBootstrapSystemMembers(loadNormalizedTeamData(configPath)).join("\n"));
    break;
  }
  case "list-project-spawn-members": {
    const [configPath = ""] = args;
    writeLines(listProjectSpawnMembers(loadNormalizedTeamData(configPath)).join("\n"));
    break;
  }
  case "list-project-spawn-teams": {
    const [configPath = ""] = args;
    writeLines(listProjectSpawnTeams(loadNormalizedTeamData(configPath)).join("\n"));
    break;
  }
  case "list-team-members": {
    const [configPath = "", teamId = "", nodeType = ""] = args;
    writeLines(listTeamMembers(loadNormalizedTeamData(configPath), teamId, nodeType).join("\n"));
    break;
  }
  case "resolve-project-member-lines": {
    const [configPath = "", registryPath = "", projectFilter = ""] = args;
    writeLines(buildProjectMemberLines(loadNormalizedTeamData(configPath), registryPath, projectFilter));
    break;
  }
  default:
    process.stderr.write(`Unknown team-normalizer command: ${command}\n`);
    process.exit(1);
}
