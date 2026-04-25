import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  GLOBAL_DECISION_SCOPE,
  PROJECT_DECISION_FILE_SUFFIX,
  formatProjectDecisionScope,
  parseDecisionScope,
  projectDecisionFileName,
} from "./decision-scope.mjs";

const GLOBAL_DECISIONS_FILE_NAME = "decisions.md";
const PROJECTS_DIR_NAME = "projects";
const DEDUPE_WINDOW = 10;

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function trimString(value) {
  return normalizeString(value).trim();
}

function collapseToSingleLine(value) {
  return normalizeString(value).replace(/\s+/gu, " ").trim();
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
    return `\`project:${target.projectName}\` 로 분류된 유저 확정 결정만 기록한다. writer 는 항상 \`user-direct\`. 자동 캡처는 사용하지 않고, 노을이는 후보를 제안할 수 있어도 writer 가 아니다. 각 결정은 \`## Decisions\` 아래 resolved 문장 한 줄로만 적는다.`;
  }

  return "유저가 전역 원칙으로 확정한 결정만 기록한다. writer 는 항상 `user-direct`. 자동 캡처는 사용하지 않고, 노을이는 후보를 제안할 수 있어도 writer 가 아니다. 각 결정은 `## Decisions` 아래 resolved 문장 한 줄로만 적는다.";
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

function parseDecisionEntries(sectionText, scope) {
  return String(sectionText ?? "")
    .replace(/\r/gu, "")
    .split("\n")
    .map((line) => trimString(line))
    .filter((line) => line && line !== "(비어 있음)")
    .filter((line) => line.startsWith("- "))
    .map((line) => collapseToSingleLine(line.slice(2)))
    .filter(Boolean)
    .map((resolvedText) => ({
      scope,
      writer: "user-direct",
      resolved_text: resolvedText,
    }));
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
    .map((entry) => `- ${collapseToSingleLine(entry.resolved_text)}`)
    .join("\n");
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
    entries: parseDecisionEntries(sections.Decisions, target.scope),
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

function normalizeDecisionEntry(entry, target) {
  const scope = trimString(entry?.scope) || target.scope;
  const writer = trimString(entry?.writer);
  const resolvedText = collapseToSingleLine(entry?.resolved_text ?? entry?.resolvedText);

  if (!scope) {
    throw new Error("decision scope is required");
  }
  if (scope !== target.scope) {
    throw new Error("decision scope must match the target store");
  }
  if (writer !== "user-direct") {
    throw new Error("decision writer must be user-direct");
  }
  if (!resolvedText) {
    throw new Error("decision resolvedText is required");
  }

  return {
    scope,
    writer,
    resolved_text: resolvedText,
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
    scope: entry.scope,
    writer: entry.writer,
    resolved_text: normalizeString(entry.resolved_text),
  };
}

export async function appendDecision({ vaultDir, entry }) {
  const target = resolveDecisionStoreTarget(vaultDir, entry?.scope);
  const document = await readDecisionsDocument(target);
  const createdAt = trimString(entry?.createdAt);
  const normalized = normalizeDecisionEntry(entry, target);

  const recentEntries = document.entries.slice(-DEDUPE_WINDOW);
  const duplicate = recentEntries.find((candidate) =>
    normalizeString(candidate.resolved_text) === normalized.resolved_text,
  );
  if (duplicate) {
    return { skipped: "duplicate", entry: toPublicEntry(duplicate) };
  }

  const nextDocument = {
    ...document,
    entries: [...document.entries, normalized],
  };
  await persistDocument(document.filePath, nextDocument, createdAt || new Date().toISOString());
  return { skipped: null, entry: toPublicEntry(normalized) };
}

export async function listDecisions({ vaultDir }) {
  const documents = await readAllDecisionDocuments(vaultDir);
  return documents.flatMap((document) =>
    document.entries
      .slice()
      .reverse()
      .map((entry) => toPublicEntry(entry)),
  );
}

export async function repartitionDecisionStores() {
  // Decision scope is now owned by the file path, so there is no mixed-entry
  // repartition step left to perform.
  return {
    movedProjectScopes: [],
    movedCount: 0,
  };
}
