import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  GLOBAL_DECISION_SCOPE,
  PROJECT_DECISION_FILE_SUFFIX,
  formatProjectDecisionScope,
  isProjectDecisionScope,
  parseDecisionScope,
  projectDecisionFileName,
} from "./decision-scope.mjs";

const GLOBAL_DECISIONS_FILE_NAME = "decisions.md";
const PROJECTS_DIR_NAME = "projects";
const DECISION_ACTIONS = new Set(["approve", "reject", "hold", "priority", "preference"]);
const KST_TIME_ZONE = "Asia/Seoul";
const DEDUPE_WINDOW = 10;

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function trimString(value) {
  return normalizeString(value).trim();
}

function isDecisionAction(value) {
  return DECISION_ACTIONS.has(trimString(value));
}

function formatParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function formatHeadingTimestamp(date) {
  const parts = formatParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function formatIdTimestamp(date) {
  const parts = formatParts(date);
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function buildDecisionId(date, entry) {
  const hash = createHash("sha1")
    .update(`${entry.action}|${entry.scope}|${entry.resolvedText}`)
    .digest("hex")
    .slice(0, 6);
  return `${formatIdTimestamp(date)}-${hash}`;
}

function quoteText(value) {
  return JSON.stringify(normalizeString(value));
}

function unquoteText(value) {
  const raw = trimString(value);
  if (!raw) {
    return "";
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw.replace(/^"(.*)"$/u, "$1");
  }
}

function parseFrontmatter(contents) {
  const lines = String(contents ?? "").replace(/\r/gu, "").split("\n");
  if (lines[0] !== "---") {
    return null;
  }

  const frontmatter = {};
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") {
      index += 1;
      break;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    frontmatter[key] = value;
  }

  return {
    frontmatter,
    body: lines.slice(index).join("\n"),
  };
}

function createDefaultFrontmatter(target, updatedAt = "") {
  if (target.kind === "project") {
    return {
      title: `${target.projectName} Project Decisions`,
      type: "special/project-decisions",
      project: target.projectName,
      updated: updatedAt,
      boot_priority: "3",
    };
  }

  return {
    title: "Decisions",
    type: "special/decisions",
    updated: updatedAt,
    boot_priority: "3",
  };
}

function createDefaultAboutText(target) {
  if (target.kind === "project") {
    return `\`project:${target.projectName}\` 로 분류된 유저 확정 결정만 기록한다. writer 는 항상 \`user-direct\`. 자동 추론/감사 append 금지.`;
  }

  return "유저가 전역 원칙으로 확정한 결정만 기록한다. writer 는 항상 `user-direct`. 자동 추론/감사 append 금지.";
}

function parseSections(body) {
  const sections = {};
  const lines = String(body ?? "").replace(/\r/gu, "").split("\n");
  let currentTitle = "";
  let buffer = [];

  function flush() {
    if (!currentTitle) {
      return;
    }

    sections[currentTitle] = buffer.join("\n").replace(/^\n+/u, "").replace(/\n+$/u, "");
  }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      currentTitle = line.slice(3).trim();
      buffer = [];
      continue;
    }

    if (currentTitle) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

function parseMarkdownFields(lines) {
  const fields = {};
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/gu, "");
    const match = line.match(/^\s*-\s+([a-z_]+):\s*(.*)$/u);
    if (!match) {
      continue;
    }

    const [, key, value] = match;
    fields[key] = value;
  }
  return fields;
}

function splitSectionIntoBlocks(sectionText) {
  const text = trimString(sectionText);
  if (!text || /^\(.*\)$/su.test(text)) {
    return [];
  }

  const firstHeadingIndex = text.indexOf("### ");
  if (firstHeadingIndex === -1) {
    return [];
  }

  return text.slice(firstHeadingIndex).trim().split(/\n(?=### )/u);
}

function parseDecisionEntries(sectionText) {
  const blocks = splitSectionIntoBlocks(sectionText);
  if (blocks.length === 0) {
    return [];
  }

  return blocks
    .map((chunk) => {
      const lines = chunk.split("\n");
      const heading = trimString(lines.shift());
      if (!heading.startsWith("### ")) {
        return null;
      }

      const headingText = heading.slice(4).trim();
      const [headingTimestamp = "", action = "", scope = ""] = headingText.split(" · ").map((part) => part.trim());
      const fields = parseMarkdownFields(lines);

      return {
        headingTimestamp,
        id: trimString(fields.id),
        action: trimString(fields.action || action),
        scope: trimString(fields.scope || scope),
        writer: trimString(fields.writer),
        resolved_text: unquoteText(fields.resolved_text),
        context_ref: normalizeString(fields.context_ref),
      };
    })
    .filter(Boolean);
}

function normalizeFrontmatter(frontmatter, updatedAt, target) {
  return {
    ...createDefaultFrontmatter(target, updatedAt),
    ...(frontmatter ?? {}),
    ...(target.kind === "project" ? { project: target.projectName } : {}),
    updated: updatedAt,
  };
}

function formatFrontmatter(frontmatter) {
  return `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n`;
}

function formatDecisionEntries(entries) {
  if (entries.length === 0) {
    return "(비어 있음)";
  }

  return entries
    .map((entry) => {
      const lines = [
        `### ${entry.headingTimestamp} · ${entry.action} · ${entry.scope}`,
        "",
        `- id: ${entry.id}`,
        `- action: ${entry.action}`,
        `- scope: ${entry.scope}`,
        `- writer: ${entry.writer}`,
        `- resolved_text: ${quoteText(entry.resolved_text)}`,
      ];

      if (trimString(entry.context_ref)) {
        lines.push(`- context_ref: ${trimString(entry.context_ref)}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function renderDecisionsFile(document) {
  const frontmatter = formatFrontmatter(document.frontmatter);
  const aboutText = trimString(document.aboutText) || createDefaultAboutText(document.target);
  const entriesText = formatDecisionEntries(document.entries);

  return `${frontmatter}\n## About\n\n${aboutText}\n\n## Decisions\n\n${entriesText}\n`;
}

function resolveDecisionStoreTarget(vaultDir, scope = GLOBAL_DECISION_SCOPE) {
  const root = resolve(vaultDir);
  const parsedScope = parseDecisionScope(scope);

  if (parsedScope.kind === "project") {
    const fileName = projectDecisionFileName(parsedScope.projectName);
    return {
      kind: "project",
      projectName: parsedScope.projectName,
      scope: parsedScope.scope,
      root,
      relativePath: `${PROJECTS_DIR_NAME}/${fileName}`,
      filePath: join(root, PROJECTS_DIR_NAME, fileName),
      sourceLabel: `~/.kuma/vault/${PROJECTS_DIR_NAME}/${fileName}`,
    };
  }

  return {
    kind: "global",
    projectName: "",
    scope: parsedScope.scope,
    root,
    relativePath: GLOBAL_DECISIONS_FILE_NAME,
    filePath: join(root, GLOBAL_DECISIONS_FILE_NAME),
    sourceLabel: `~/.kuma/vault/${GLOBAL_DECISIONS_FILE_NAME}`,
  };
}

function createEmptyDocument(target, updatedAt = "") {
  return {
    target,
    frontmatter: createDefaultFrontmatter(target, updatedAt),
    aboutText: createDefaultAboutText(target),
    entries: [],
  };
}

async function ensureDecisionsFile(target) {
  await mkdir(dirname(target.filePath), { recursive: true });

  if (!existsSync(target.filePath)) {
    const updatedAt = new Date().toISOString();
    await writeFile(target.filePath, renderDecisionsFile(createEmptyDocument(target, updatedAt)), "utf8");
  }

  return target.filePath;
}

async function readDecisionsDocument(target) {
  const filePath = await ensureDecisionsFile(target);
  const contents = await readFile(filePath, "utf8");
  const parsed = parseFrontmatter(contents);
  const sections = parsed ? parseSections(parsed.body) : {};
  return {
    target,
    filePath,
    frontmatter: normalizeFrontmatter(parsed?.frontmatter, trimString(parsed?.frontmatter?.updated), target),
    aboutText: sections.About || createDefaultAboutText(target),
    entries: parseDecisionEntries(sections.Decisions),
  };
}

async function listDecisionStoreTargets(vaultDir) {
  const root = resolve(vaultDir);
  const targets = [resolveDecisionStoreTarget(root, GLOBAL_DECISION_SCOPE)];
  const projectsDir = join(root, PROJECTS_DIR_NAME);

  if (!existsSync(projectsDir)) {
    return targets;
  }

  const entries = await readdir(projectsDir, { withFileTypes: true });
  const projectTargets = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(PROJECT_DECISION_FILE_SUFFIX))
    .map((entry) => entry.name.slice(0, -PROJECT_DECISION_FILE_SUFFIX.length))
    .map((projectName) => resolveDecisionStoreTarget(root, formatProjectDecisionScope(projectName)))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  return [...targets, ...projectTargets];
}

async function readAllDecisionDocuments(vaultDir) {
  const targets = await listDecisionStoreTargets(vaultDir);
  return Promise.all(targets.map((target) => readDecisionsDocument(target)));
}

function normalizeDecisionEntry(entry, now = new Date()) {
  const action = trimString(entry?.action);
  const scope = trimString(entry?.scope);
  const writer = trimString(entry?.writer);
  const resolvedText = normalizeString(entry?.resolved_text ?? entry?.resolvedText);
  const contextRef = normalizeString(entry?.context_ref ?? entry?.contextRef);

  if (!isDecisionAction(action)) {
    throw new Error("decision action is required");
  }
  if (!scope) {
    throw new Error("decision scope is required");
  }
  if (writer !== "user-direct") {
    throw new Error("decision writer must be user-direct");
  }
  if (!resolvedText) {
    throw new Error("decision resolvedText is required");
  }

  return {
    id: trimString(entry?.id) || buildDecisionId(now, { action, scope, resolvedText }),
    headingTimestamp: trimString(entry?.headingTimestamp) || formatHeadingTimestamp(now),
    writer,
    action,
    scope,
    resolved_text: resolvedText,
    context_ref: contextRef,
  };
}

async function persistDocument(filePath, document, updatedAt) {
  const nextDocument = {
    ...document,
    frontmatter: normalizeFrontmatter(document.frontmatter, updatedAt, document.target),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderDecisionsFile(nextDocument), "utf8");
}

function toPublicEntry(entry) {
  return {
    id: entry.id,
    action: entry.action,
    scope: entry.scope,
    writer: entry.writer,
    resolved_text: normalizeString(entry.resolved_text),
    context_ref: normalizeString(entry.context_ref),
    headingTimestamp: trimString(entry.headingTimestamp),
  };
}

export async function appendDecision({ vaultDir, entry }) {
  const target = resolveDecisionStoreTarget(vaultDir, entry?.scope);
  const document = await readDecisionsDocument(target);
  const createdAt = trimString(entry?.createdAt);
  const now = new Date(createdAt || Date.now());
  const normalized = normalizeDecisionEntry(entry, now);

  const recentEntries = document.entries.slice(-DEDUPE_WINDOW);
  const duplicate = recentEntries.find((candidate) =>
    candidate.action === normalized.action &&
    normalizeString(candidate.resolved_text) === normalized.resolved_text,
  );
  if (duplicate) {
    return { skipped: "duplicate", entry: toPublicEntry(duplicate) };
  }

  const nextDocument = {
    ...document,
    entries: [...document.entries, normalized],
  };
  await persistDocument(document.filePath, nextDocument, createdAt || now.toISOString());
  return { skipped: null, entry: toPublicEntry(normalized) };
}

export async function listDecisions({ vaultDir }) {
  const documents = await readAllDecisionDocuments(vaultDir);
  return documents
    .flatMap((document) => document.entries.map(toPublicEntry))
    .sort((left, right) => right.id.localeCompare(left.id));
}

function buildBootPackSection(target, document, { limit }) {
  const entries = document ? document.entries.map(toPublicEntry) : [];
  return {
    source: target.sourceLabel,
    scope: target.scope,
    projectName: target.projectName,
    decisions: entries.slice(-limit).reverse(),
  };
}

export async function loadDecisionBootPack({
  vaultDir,
  projectName = "",
  limit = 20,
} = {}) {
  const activeVaultDir = resolve(vaultDir ?? join(process.env.HOME ?? ".", ".kuma", "vault"));
  const limits = { limit };
  const globalTarget = resolveDecisionStoreTarget(activeVaultDir, GLOBAL_DECISION_SCOPE);
  const globalDocument = existsSync(globalTarget.filePath) ? await readDecisionsDocument(globalTarget) : null;
  const globalPack = buildBootPackSection(globalTarget, globalDocument, limits);

  const projectScope = formatProjectDecisionScope(projectName);
  const projectTarget = projectScope ? resolveDecisionStoreTarget(activeVaultDir, projectScope) : null;
  const projectDocument = projectTarget && existsSync(projectTarget.filePath)
    ? await readDecisionsDocument(projectTarget)
    : null;
  const projectPack = projectTarget && projectDocument ? buildBootPackSection(projectTarget, projectDocument, limits) : null;

  return {
    decisions: globalPack.decisions,
    global: globalPack,
    project: projectPack,
  };
}

function mergeEntriesById(existingEntries, incomingEntries) {
  const merged = existingEntries.slice();
  const seenIds = new Set(existingEntries.map((entry) => entry.id));
  for (const entry of incomingEntries) {
    if (seenIds.has(entry.id)) {
      continue;
    }
    seenIds.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

export async function repartitionDecisionStores({ vaultDir } = {}) {
  const activeVaultDir = resolve(vaultDir ?? join(process.env.HOME ?? ".", ".kuma", "vault"));
  const globalTarget = resolveDecisionStoreTarget(activeVaultDir, GLOBAL_DECISION_SCOPE);
  if (!existsSync(globalTarget.filePath)) {
    return {
      movedProjectScopes: [],
      movedCount: 0,
    };
  }

  const globalDocument = await readDecisionsDocument(globalTarget);
  const nextGlobalEntries = [];
  const projectGroups = new Map();

  for (const entry of globalDocument.entries) {
    if (isProjectDecisionScope(entry.scope)) {
      const target = resolveDecisionStoreTarget(activeVaultDir, entry.scope);
      const current = projectGroups.get(target.scope) ?? { target, entries: [] };
      current.entries.push(entry);
      projectGroups.set(target.scope, current);
    } else {
      nextGlobalEntries.push(entry);
    }
  }

  if (projectGroups.size === 0) {
    return {
      movedProjectScopes: [],
      movedCount: 0,
    };
  }

  const updatedAt = new Date().toISOString();
  for (const { target, entries } of projectGroups.values()) {
    const projectDocument = existsSync(target.filePath)
      ? await readDecisionsDocument(target)
      : createEmptyDocument(target, updatedAt);

    await persistDocument(target.filePath, {
      ...projectDocument,
      entries: mergeEntriesById(projectDocument.entries, entries),
    }, updatedAt);
  }

  await persistDocument(globalTarget.filePath, {
    ...globalDocument,
    entries: nextGlobalEntries,
  }, updatedAt);

  return {
    movedProjectScopes: [...projectGroups.keys()].sort(),
    movedCount: [...projectGroups.values()].reduce((sum, group) => sum + group.entries.length, 0),
  };
}
