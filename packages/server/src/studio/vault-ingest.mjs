import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { resolveVaultDir } from "./memo-store.mjs";
import { inferProjectIdFromSlugPrefix } from "./project-defaults.mjs";

const VAULT_SECTION_DIRS = ["domains", "projects", "learnings", "inbox"];
const DEFAULT_SCHEMA_CONTENT = `---
title: Kuma Vault Schema
description: Vault 페이지 작성 규칙과 운영 원칙
---

# Kuma Vault Schema

## 원칙
1. Single Source of Truth
2. Append-friendly
3. 교차참조
4. QA 통과 결과만 ingest
`;

function normalizeLineEndings(value) {
  return String(value ?? "").replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function normalizeFrontmatterValue(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    return inner
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        if (
          (item.startsWith('"') && item.endsWith('"')) ||
          (item.startsWith("'") && item.endsWith("'"))
        ) {
          return item.slice(1, -1);
        }

        return item;
      });
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseFrontmatterDocument(content = "") {
  const safeContent = normalizeLineEndings(content);
  const lines = safeContent.split("\n");

  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: safeContent.trim() };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return { frontmatter: {}, body: safeContent.trim() };
  }

  const frontmatter = Object.create(null);
  let currentArrayKey = null;

  for (const rawLine of lines.slice(1, closingIndex)) {
    const line = rawLine.trimEnd();
    const arrayItem = line.match(/^\s*-\s*(.+)$/u);
    if (currentArrayKey && arrayItem) {
      frontmatter[currentArrayKey].push(normalizeFrontmatterValue(arrayItem[1]));
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!match) {
      currentArrayKey = null;
      continue;
    }

    const [, key, rawValue] = match;
    if (rawValue.trim() === "") {
      frontmatter[key] = [];
      currentArrayKey = key;
      continue;
    }

    currentArrayKey = null;
    frontmatter[key] = normalizeFrontmatterValue(rawValue);
  }

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join("\n").trim(),
  };
}

function formatFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatInlineArrayItem(item)).join(", ")}]`;
  }

  return String(value ?? "");
}

function formatInlineArrayItem(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return '""';
  }

  if (/^[A-Za-z0-9._/-]+$/u.test(text)) {
    return text;
  }

  return JSON.stringify(text);
}

export function stringifyFrontmatter(frontmatter) {
  const entries = Object.entries(frontmatter)
    .filter(([, value]) => value != null);
  const lines = entries.map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`);
  return `---\n${lines.join("\n")}\n---`;
}

function splitSections(body) {
  const normalized = normalizeLineEndings(body).trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const sections = [];
  let current = { heading: null, lines: [] };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/u);
    if (headingMatch) {
      if (current.heading || current.lines.length > 0) {
        sections.push({
          heading: current.heading,
          content: current.lines.join("\n").trim(),
        });
      }
      current = { heading: headingMatch[1].trim(), lines: [] };
      continue;
    }

    current.lines.push(line);
  }

  sections.push({
    heading: current.heading,
    content: current.lines.join("\n").trim(),
  });

  return sections;
}

function sectionsToMap(body) {
  const sections = new Map();
  for (const section of splitSections(body)) {
    if (section.heading) {
      sections.set(section.heading, section.content);
    }
  }
  return sections;
}

function formatSections(sectionMap) {
  const orderedHeadings = ["Summary", "Details", "Related"];
  return orderedHeadings
    .map((heading) => `## ${heading}\n${String(sectionMap.get(heading) ?? "").trim() || "(비어 있음)"}`)
    .join("\n\n")
    .trim();
}

function sanitizeSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.result$/u, "")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "") || "untitled";
}

function humanizeSlug(value) {
  const normalized = String(value ?? "").replace(/[-_]+/gu, " ").trim();
  if (!normalized) {
    return "Untitled";
  }
  return normalized;
}

function stripLeadingTitleHeading(body) {
  const normalized = normalizeLineEndings(body).trim();
  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n");
  if (lines[0]?.match(/^#\s+/u)) {
    return lines.slice(1).join("\n").trim();
  }

  return normalized;
}

function demoteMarkdownHeadings(body, increment = 2) {
  return normalizeLineEndings(body)
    .split("\n")
    .map((line) => {
      const match = line.match(/^(#{1,6})(\s+.+)$/u);
      if (!match) {
        return line;
      }

      const level = Math.min(match[1].length + increment, 6);
      return `${"#".repeat(level)}${match[2]}`;
    })
    .join("\n")
    .trim();
}

function extractTitle(body, fallback) {
  const lines = normalizeLineEndings(body).split("\n");
  const headingLine = lines.find((line) => /^#\s+.+$/u.test(line.trim()));
  if (headingLine) {
    return headingLine.replace(/^#\s+/u, "").trim();
  }

  return fallback;
}

function extractSummary(body, fallback) {
  const sections = sectionsToMap(body);
  const explicitSummary = sections.get("Summary");
  if (explicitSummary) {
    const lines = explicitSummary
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("- "));
    if (lines.length > 0) {
      return lines.slice(0, 3).join(" ");
    }
  }

  const content = stripLeadingTitleHeading(body);
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^##\s+/u.test(line))
    .filter((line) => !/^###\s+/u.test(line))
    .filter((line) => !/^[-*]\s+/u.test(line));

  if (lines.length > 0) {
    return lines.slice(0, 3).join(" ");
  }

  return fallback;
}

export function parseTaskLikeMetadata(content = "") {
  const lines = normalizeLineEndings(content).split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "---");
  if (startIndex === -1) {
    return {};
  }

  const endIndex = lines.findIndex((line, index) => index > startIndex && line.trim() === "---");
  if (endIndex === -1) {
    return {};
  }

  const metadata = Object.create(null);
  for (const line of lines.slice(startIndex + 1, endIndex)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/u);
    if (!match) {
      continue;
    }
    metadata[match[1]] = normalizeFrontmatterValue(match[2]);
  }

  return metadata;
}

export async function findMatchingTaskMetadata(resultPath, taskDir) {
  if (!taskDir || !existsSync(taskDir)) {
    return null;
  }

  const entries = await readdir(taskDir, { withFileTypes: true });
  const normalizedResultPath = resolve(resultPath);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".task.md")) {
      continue;
    }

    const fullPath = join(taskDir, entry.name);
    const content = await readFile(fullPath, "utf8");
    const metadata = parseTaskLikeMetadata(content);
    const referencedResult = typeof metadata.result === "string" ? resolve(metadata.result) : null;

    if (referencedResult === normalizedResultPath) {
      return metadata;
    }
  }

  return null;
}

function inferProjectFromSourceName(sourceSlug) {
  return inferProjectIdFromSlugPrefix(sourceSlug);
}

function inferTargetDescriptor(resultMeta, options = {}) {
  const pageOverride = typeof options.page === "string" && options.page.trim()
    ? options.page.trim().replace(/^\/+/u, "")
    : null;
  if (pageOverride) {
    const section = pageOverride.includes("/") ? pageOverride.split("/")[0] : "learnings";
    const fileName = pageOverride.includes("/") ? pageOverride.split("/").slice(1).join("/") : pageOverride;
    const slug = basename(fileName, extname(fileName));
    return {
      section,
      slug,
      relativePath: pageOverride.endsWith(".md") ? pageOverride : `${pageOverride}.md`,
    };
  }

  const explicitSection = typeof options.section === "string" && options.section.trim()
    ? options.section.trim()
    : null;
  const explicitSlug = typeof options.slug === "string" && options.slug.trim()
    ? sanitizeSlug(options.slug)
    : null;

  const project = resultMeta.project ?? inferProjectFromSourceName(resultMeta.sourceSlug);
  if (project && !explicitSection) {
    const slug = explicitSlug ?? sanitizeSlug(project);
    return {
      section: "projects",
      slug,
      relativePath: join("projects", `${slug}.md`),
    };
  }

  const section = explicitSection ?? "learnings";
  const slug = explicitSlug ?? sanitizeSlug(resultMeta.taskId ?? resultMeta.sourceSlug);
  return {
    section,
    slug,
    relativePath: join(section, `${slug}.md`),
  };
}

function mergeTags(existingTags, nextTags) {
  return Array.from(
    new Set(
      [...(Array.isArray(existingTags) ? existingTags : []), ...(Array.isArray(nextTags) ? nextTags : [])]
        .map((tag) => String(tag ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function inferTags(resultMeta, target) {
  const tags = new Set();
  tags.add(target.section);

  if (resultMeta.project) {
    tags.add(resultMeta.project);
  }

  for (const part of String(resultMeta.taskId ?? resultMeta.sourceSlug).split(/[-_]/u)) {
    const normalized = part.trim().toLowerCase();
    if (normalized.length >= 3) {
      tags.add(normalized);
    }
  }

  return Array.from(tags);
}

function buildIngestBlock(resultMeta, qaStatus) {
  const dateLabel = resultMeta.updatedDate;
  const lines = [
    `### ${dateLabel} · ${resultMeta.title}`,
    "",
    `- Source: \`${resultMeta.sourcePath}\``,
    `- Task: \`${resultMeta.taskId}\``,
  ];

  if (resultMeta.status) {
    lines.push(`- Status: \`${resultMeta.status}\``);
  }
  if (resultMeta.worker) {
    lines.push(`- Worker: \`${resultMeta.worker}\``);
  }
  if (resultMeta.qa) {
    lines.push(`- QA: \`${resultMeta.qa}\``);
  }
  lines.push(`- QA Verdict: \`${qaStatus}\``);
  lines.push("");

  const body = stripLeadingTitleHeading(resultMeta.body);
  if (body) {
    lines.push(demoteMarkdownHeadings(body));
  } else {
    lines.push(resultMeta.summary);
  }

  return lines.join("\n").trim();
}

function upsertDetailsSection(detailsContent, blockId, blockContent) {
  const startMarker = `<!-- ingest:${blockId}:start -->`;
  const endMarker = `<!-- ingest:${blockId}:end -->`;
  const block = `${startMarker}\n${blockContent}\n${endMarker}`;
  const normalizedDetails = String(detailsContent ?? "").trim();
  const markerPattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
    "u",
  );

  if (markerPattern.test(normalizedDetails)) {
    return {
      content: normalizedDetails.replace(markerPattern, block).trim(),
      action: "updated",
    };
  }

  if (!normalizedDetails || /^\(.+\)$/u.test(normalizedDetails)) {
    return { content: block, action: "created" };
  }

  return {
    content: `${normalizedDetails}\n\n${block}`.trim(),
    action: "created",
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parsePageDocument(content = "") {
  const { frontmatter, body } = parseFrontmatterDocument(content);
  return {
    frontmatter,
    sections: sectionsToMap(body),
    body,
  };
}

export function extractFrontmatterSources(frontmatter = {}) {
  if (Array.isArray(frontmatter.sources) && frontmatter.sources.length > 0) {
    return frontmatter.sources
      .map((source) => String(source ?? "").trim())
      .filter(Boolean);
  }

  if (typeof frontmatter.source === "string" && frontmatter.source.trim()) {
    return [frontmatter.source.trim()];
  }

  if (typeof frontmatter.sourcePath === "string" && frontmatter.sourcePath.trim()) {
    return [frontmatter.sourcePath.trim()];
  }

  return [];
}

function normalizeSourceDisplayName(source) {
  const value = String(source ?? "").trim();
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\\/gu, "/");
  const skillsMarker = "/.claude/skills/";
  const genericSkillsMarker = "/skills/";
  const vaultMarker = "/.kuma/vault/";

  if (normalized.startsWith("skills/")) {
    return normalized;
  }

  if (normalized.includes(skillsMarker)) {
    return `skills/${normalized.split(skillsMarker)[1]}`;
  }

  if (normalized.includes(genericSkillsMarker)) {
    return `skills/${normalized.split(genericSkillsMarker)[1]}`;
  }

  if (normalized.includes(vaultMarker)) {
    return `vault/${normalized.split(vaultMarker)[1]}`;
  }

  if (normalized.startsWith("/")) {
    return basename(normalized);
  }

  return normalized;
}

function parseRelatedBullets(relatedContent = "") {
  return normalizeLineEndings(relatedContent)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

function createPageTitle(target, resultMeta, overrideTitle = null) {
  if (overrideTitle) {
    return overrideTitle;
  }

  if (target.section === "projects" && resultMeta.project) {
    return `${resultMeta.project} 프로젝트 지식`;
  }

  return resultMeta.title || humanizeSlug(target.slug);
}

function buildRelatedSection(existingRelated, target, resultMeta) {
  const bullets = new Set(parseRelatedBullets(existingRelated));

  if (target.section !== "projects" && resultMeta.project) {
    const projectSlug = sanitizeSlug(resultMeta.project);
    bullets.add(`- [${resultMeta.project}](../projects/${projectSlug}.md) — 관련 프로젝트 지식`);
  }

  const values = Array.from(bullets);
  return values.length > 0 ? values.join("\n") : "(교차참조 추가 예정)";
}

export async function ensureVaultScaffold(vaultDir) {
  await mkdir(vaultDir, { recursive: true });

  for (const section of VAULT_SECTION_DIRS) {
    await mkdir(join(vaultDir, section), { recursive: true });
  }

  const schemaPath = join(vaultDir, "schema.md");
  if (!existsSync(schemaPath)) {
    await writeFile(schemaPath, `${DEFAULT_SCHEMA_CONTENT.trim()}\n`, "utf8");
  }

  const logPath = join(vaultDir, "log.md");
  if (!existsSync(logPath)) {
    await writeFile(logPath, "# Kuma Vault Change Log\n", "utf8");
  }
}

async function readVaultEntry(filePath, section) {
  const content = await readFile(filePath, "utf8");
  const parsed = parsePageDocument(content);
  const summary = String(parsed.sections.get("Summary") ?? "").trim() || extractSummary(parsed.body, basename(filePath, ".md"));
  const details = String(parsed.sections.get("Details") ?? "").trim();
  const related = String(parsed.sections.get("Related") ?? "").trim();

  return {
    section,
    filePath,
    relativePath: join(section, basename(filePath)),
    slug: basename(filePath, ".md"),
    title: String(parsed.frontmatter.title ?? basename(filePath, ".md")),
    summary: summary && !summary.startsWith("(") ? summary.replace(/\n+/gu, " ").trim() : "",
    sources: extractFrontmatterSources(parsed.frontmatter),
    relatedBullets: parseRelatedBullets(related),
    details,
  };
}

async function collectVaultEntries(vaultDir) {
  const entries = [];

  for (const section of ["domains", "projects", "learnings"]) {
    const sectionDir = join(vaultDir, section);
    if (!existsSync(sectionDir)) {
      continue;
    }

    const files = await readdir(sectionDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || extname(file.name).toLowerCase() !== ".md") {
        continue;
      }
      entries.push(await readVaultEntry(join(sectionDir, file.name), section));
    }
  }

  const inboxDir = join(vaultDir, "inbox");
  if (existsSync(inboxDir)) {
    const files = await readdir(inboxDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) {
        continue;
      }
      const extension = extname(file.name).toLowerCase();
      if (![".md", ".txt", ".json", ".log"].includes(extension)) {
        continue;
      }

      const fullPath = join(inboxDir, file.name);
      if (extension === ".md") {
        entries.push(await readVaultEntry(fullPath, "inbox"));
        continue;
      }

      const fileStat = await stat(fullPath);
      entries.push({
        section: "inbox",
        filePath: fullPath,
        relativePath: join("inbox", file.name),
        slug: basename(file.name, extension),
        title: basename(file.name, extension),
        summary: `created ${fileStat.mtime.toISOString().slice(0, 10)}`,
        sources: [],
        relatedBullets: [],
        details: "",
      });
    }
  }

  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function detectUnindexedDomainPages(vaultDir) {
  const indexPath = join(vaultDir, "index.md");
  if (!existsSync(indexPath)) {
    return [];
  }

  const indexContent = normalizeLineEndings(await readFile(indexPath, "utf8"));
  const referenced = new Set(
    Array.from(indexContent.matchAll(/\((domains\/[^)]+\.md)\)/gu), (match) => match[1]),
  );
  const entries = await collectVaultEntries(vaultDir);

  return entries
    .filter((entry) => entry.section === "domains")
    .filter((entry) => !referenced.has(entry.relativePath.replace(/\\/gu, "/")))
    .map((entry) => entry.relativePath.replace(/\\/gu, "/"))
    .sort((left, right) => left.localeCompare(right));
}

export async function rewriteIndex(vaultDir) {
  const entries = await collectVaultEntries(vaultDir);
  const bySection = new Map(
    ["domains", "projects", "learnings", "inbox"].map((section) => [
      section,
      entries.filter((entry) => entry.section === section),
    ]),
  );

  const lines = ["# Kuma Vault Index", ""];

  for (const [section, heading] of [
    ["domains", "Domains"],
    ["projects", "Projects"],
    ["learnings", "Learnings"],
    ["inbox", "Inbox"],
  ]) {
    lines.push(`## ${heading}`);
    const sectionEntries = bySection.get(section) ?? [];
    if (sectionEntries.length === 0) {
      lines.push(section === "inbox" ? "(비어 있음)" : "(아직 없음)");
    } else {
      for (const entry of sectionEntries) {
        const summary = entry.summary || "요약 없음";
        lines.push(`- [${entry.title}](${entry.relativePath.replace(/\\/gu, "/")}) — ${summary}`);
      }
    }
    lines.push("");
  }

  lines.push("## Cross References");
  const crossReferences = [];
  for (const entry of entries) {
    const sourceNames = Array.from(
      new Set(
        entry.sources
          .map((source) => normalizeSourceDisplayName(source))
          .filter(Boolean),
      ),
    );
    if (sourceNames.length > 0) {
      crossReferences.push(`- ${entry.slug} ← ${sourceNames.join(", ")}`);
    }

    for (const bullet of entry.relatedBullets) {
      crossReferences.push(`- ${entry.slug} ${bullet.slice(1).trim()}`);
    }
  }

  if (crossReferences.length === 0) {
    lines.push("(아직 없음)");
  } else {
    lines.push(...crossReferences.sort((left, right) => left.localeCompare(right)));
  }

  lines.push("");
  lines.push(`Last updated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  await writeFile(join(vaultDir, "index.md"), lines.join("\n"), "utf8");
}

export async function appendLogEntry(vaultDir, message) {
  const logPath = join(vaultDir, "log.md");
  const today = new Date().toISOString().slice(0, 10);
  const heading = `## ${today}`;
  const line = `- ${message}`;
  const existing = existsSync(logPath) ? normalizeLineEndings(await readFile(logPath, "utf8")).trimEnd() : "# Kuma Vault Change Log";

  let next;
  if (!existing.includes(heading)) {
    next = `${existing}\n\n${heading}\n${line}\n`;
  } else {
    const pattern = new RegExp(`(${escapeRegExp(heading)}\\n)([\\s\\S]*?)(?=\\n##\\s+\\d{4}-\\d{2}-\\d{2}|$)`, "u");
    next = `${existing}\n`.replace(pattern, (_match, prefix, block) => `${prefix}${block}${block.endsWith("\n") ? "" : "\n"}${line}\n`);
  }

  await writeFile(logPath, next, "utf8");
}

export async function ingestResultFile({
  resultPath,
  vaultDir,
  wikiDir,
  taskDir = "/tmp/kuma-tasks",
  qaStatus = "passed",
  section = null,
  slug = null,
  page = null,
  title = null,
  dryRun = false,
} = {}) {
  const activeVaultDir = vaultDir ?? wikiDir ?? resolveVaultDir();

  if (qaStatus !== "passed") {
    throw new Error("vault ingest requires --qa-status passed.");
  }

  if (typeof resultPath !== "string" || !resultPath.trim()) {
    throw new Error("resultPath is required.");
  }

  const resolvedResultPath = resolve(resultPath);
  const resultContent = await readFile(resolvedResultPath, "utf8");
  const parsedResult = parseFrontmatterDocument(resultContent);
  const taskMetadata = await findMatchingTaskMetadata(resolvedResultPath, taskDir);
  const sourceSlug = sanitizeSlug(
    basename(resolvedResultPath)
      .replace(/\.result\.md$/u, "")
      .replace(/\.md$/u, ""),
  );
  const fallbackTitle = humanizeSlug(parsedResult.frontmatter.id ?? parsedResult.frontmatter.task ?? sourceSlug);
  const resultMeta = {
    sourcePath: resolvedResultPath,
    sourceName: basename(resolvedResultPath),
    sourceSlug,
    taskId:
      String(
        parsedResult.frontmatter.id ??
        parsedResult.frontmatter.task ??
        taskMetadata?.id ??
        sourceSlug,
      ).trim(),
    project:
      typeof parsedResult.frontmatter.project === "string" && parsedResult.frontmatter.project.trim()
        ? parsedResult.frontmatter.project.trim()
        : typeof taskMetadata?.project === "string" && taskMetadata.project.trim()
          ? taskMetadata.project.trim()
          : inferProjectFromSourceName(sourceSlug),
    status:
      typeof parsedResult.frontmatter.status === "string" ? parsedResult.frontmatter.status.trim() : "",
    worker:
      typeof parsedResult.frontmatter.worker === "string"
        ? parsedResult.frontmatter.worker.trim()
        : typeof taskMetadata?.worker === "string"
          ? taskMetadata.worker.trim()
          : "",
    qa:
      typeof parsedResult.frontmatter.qa === "string"
        ? parsedResult.frontmatter.qa.trim()
        : typeof taskMetadata?.qa === "string"
          ? taskMetadata.qa.trim()
          : "",
    title: extractTitle(parsedResult.body, fallbackTitle),
    summary: extractSummary(parsedResult.body, fallbackTitle),
    body: parsedResult.body,
    updatedDate: new Date().toISOString().slice(0, 10),
  };

  const target = inferTargetDescriptor(resultMeta, { section, slug, page });
  const pagePath = join(activeVaultDir, target.relativePath);

  await ensureVaultScaffold(activeVaultDir);
  await mkdir(join(activeVaultDir, target.section), { recursive: true });

  const existingContent = existsSync(pagePath) ? await readFile(pagePath, "utf8") : "";
  const existingPage = parsePageDocument(existingContent);
  const frontmatter = {
    title: String(existingPage.frontmatter.title ?? createPageTitle(target, resultMeta, title)),
    domain: String(
      existingPage.frontmatter.domain ??
      (target.section === "projects" ? (resultMeta.project ?? "projects") : target.section),
    ),
    tags: mergeTags(existingPage.frontmatter.tags, inferTags(resultMeta, target)),
    created: String(existingPage.frontmatter.created ?? resultMeta.updatedDate),
    updated: resultMeta.updatedDate,
    sources: mergeTags(existingPage.frontmatter.sources, [resolvedResultPath]),
  };

  const detailsBlockId = basename(resolvedResultPath);
  const nextSummary =
    String(existingPage.sections.get("Summary") ?? "").trim() &&
    !String(existingPage.sections.get("Summary") ?? "").trim().startsWith("(")
      ? String(existingPage.sections.get("Summary") ?? "").trim()
      : resultMeta.summary;

  const detailsUpdate = upsertDetailsSection(
    existingPage.sections.get("Details") ?? "",
    detailsBlockId,
    buildIngestBlock(resultMeta, qaStatus),
  );

  const nextSections = new Map();
  nextSections.set("Summary", nextSummary);
  nextSections.set("Details", detailsUpdate.content);
  nextSections.set(
    "Related",
    buildRelatedSection(existingPage.sections.get("Related") ?? "", target, resultMeta),
  );

  const pageContent = `${stringifyFrontmatter(frontmatter)}\n\n${formatSections(nextSections)}\n`;
  const relativePagePath = target.relativePath.replace(/\\/gu, "/");
  const operation = existsSync(pagePath) ? (detailsUpdate.action === "updated" ? "UPDATE" : "INGEST") : "CREATE";

  if (!dryRun) {
    await writeFile(pagePath, pageContent, "utf8");
    await rewriteIndex(activeVaultDir);
    await appendLogEntry(
      activeVaultDir,
      `${operation}: \`${basename(resolvedResultPath)}\` → \`${relativePagePath}\` (qa: ${qaStatus})`,
    );
  }

  return {
    action: operation,
    pagePath,
    relativePagePath,
    vaultDir: activeVaultDir,
    taskId: resultMeta.taskId,
    project: resultMeta.project,
    sourcePath: resolvedResultPath,
    dryRun,
  };
}
