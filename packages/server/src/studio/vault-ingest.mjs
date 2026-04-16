import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { DEFAULT_DISPATCH_RESULT_DIR, DEFAULT_DISPATCH_TASK_DIR, DEFAULT_VAULT_INGEST_STAMP_DIR } from "../kuma-paths.mjs";
import { resolveVaultDir } from "./memo-store.mjs";
import {
  getConfiguredDefaultProjectId,
  inferProjectIdFromSlugPrefix,
  readPackageProjectId,
  readProjectsRegistry,
} from "./project-defaults.mjs";

const VAULT_SECTION_DIRS = ["domains", "projects", "learnings", "inbox"];
const INGESTIBLE_INBOX_EXTENSIONS = new Set([".md", ".txt", ".json", ".log"]);
const PROJECT_ROUTING_KEYWORDS = [
  "project", "milestone", "roadmap", "backlog", "issue", "issues", "todo", "task", "tasks",
  "architecture", "migration", "release", "deploy", "deployment", "sprint", "spec", "prd",
  "프로젝트", "마일스톤", "로드맵", "백로그", "이슈", "할일", "작업", "아키텍처", "마이그레이션", "릴리즈", "배포", "명세",
];
const LEARNING_ROUTING_KEYWORDS = [
  "rule", "rules", "guideline", "guidelines", "playbook", "runbook", "checklist", "postmortem", "rca",
  "debug", "debugging", "troubleshoot", "troubleshooting", "lesson", "lessons", "benchmark", "performance",
  "timeout", "flaky", "incident", "recovery", "pattern",
  "규칙", "원칙", "가이드", "가이드라인", "플레이북", "런북", "체크리스트", "장애", "원인", "복구", "디버깅", "교훈", "벤치마크", "성능", "패턴",
];
const DOMAIN_ROUTING_KEYWORDS = [
  "company", "service", "product", "vendor", "market", "competitor", "website", "homepage", "pricing",
  "price", "plan", "feature", "platform", "api", "sdk", "library", "tool", "resume", "portfolio", "candidate",
  "회사", "서비스", "제품", "사이트", "홈페이지", "가격", "요금", "플랜", "기능", "플랫폼", "api", "라이브러리", "도구", "이력서", "포트폴리오", "후보자",
];
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

function isLikelyUrl(value) {
  return /^https?:\/\//iu.test(String(value ?? "").trim());
}

function normalizeRoutingText(value) {
  return String(value ?? "").toLowerCase();
}

function countKeywordHits(haystack, keywords) {
  let score = 0;
  for (const keyword of keywords) {
    if (haystack.includes(normalizeRoutingText(keyword))) {
      score += 1;
    }
  }
  return score;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function getKnownProjectIds() {
  const registryIds = Object.keys(readProjectsRegistry());
  const packageIds = [
    readPackageProjectId(process.env.KUMA_STUDIO_WORKSPACE),
    readPackageProjectId(process.cwd()),
  ].filter(Boolean);
  const defaultIds = [getConfiguredDefaultProjectId({ fallback: null })].filter(Boolean);

  return Array.from(new Set([...registryIds, ...packageIds, ...defaultIds]))
    .map((projectId) => String(projectId ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function detectProjectIdFromContent(documentMeta) {
  const haystack = normalizeRoutingText([
    documentMeta?.title,
    documentMeta?.summary,
    documentMeta?.body,
    documentMeta?.sourcePath,
    documentMeta?.sourceName,
    documentMeta?.taskId,
  ].filter(Boolean).join("\n"));

  for (const projectId of getKnownProjectIds()) {
    const flexibleProjectPattern = projectId
      .toLowerCase()
      .split(/[-_\s]+/u)
      .filter(Boolean)
      .map((part) => escapeRegExp(part))
      .join("[-_\\s]*");
    const pattern = new RegExp(`(^|[^a-z0-9])${flexibleProjectPattern}([^a-z0-9]|$)`, "u");
    if (pattern.test(haystack)) {
      return projectId;
    }
  }

  return null;
}

export function analyzeDocumentRouting({ documentMeta, explicitSection = null, page = null, sourceType = "text" }) {
  if (page || explicitSection) {
    return {
      section: explicitSection,
      project: documentMeta?.project ?? null,
      confidence: "explicit",
      ambiguous: false,
      reason: page ? "explicit-page" : "explicit-section",
      scores: {
        projects: 0,
        learnings: 0,
        domains: 0,
      },
      candidates: [],
    };
  }

  const inferredProject =
    documentMeta?.project ??
    detectProjectIdFromContent(documentMeta) ??
    inferProjectFromSourceName(documentMeta?.sourceSlug ?? "");
  const haystack = normalizeRoutingText([
    documentMeta?.title,
    documentMeta?.summary,
    documentMeta?.body,
    documentMeta?.sourcePath,
    documentMeta?.sourceName,
    documentMeta?.taskId,
  ].filter(Boolean).join("\n"));

  const projectScore = (inferredProject ? 2 : 0) + countKeywordHits(haystack, PROJECT_ROUTING_KEYWORDS);
  const learningScore = countKeywordHits(haystack, LEARNING_ROUTING_KEYWORDS);
  const domainScore = (sourceType === "url" ? 1 : 0) + countKeywordHits(haystack, DOMAIN_ROUTING_KEYWORDS);
  const candidates = [
    { section: "projects", score: projectScore, project: inferredProject },
    { section: "learnings", score: learningScore, project: inferredProject },
    { section: "domains", score: domainScore, project: inferredProject },
  ].sort((left, right) => right.score - left.score || left.section.localeCompare(right.section));
  const prioritizeCandidates = (chosenSection) => [
    ...candidates.filter((candidate) => candidate.section === chosenSection),
    ...candidates.filter((candidate) => candidate.section !== chosenSection),
  ];
  const top = candidates[0] ?? { section: "learnings", score: 0 };
  const second = candidates[1] ?? { section: null, score: 0 };
  const ambiguous =
    top.score <= 1 ||
    (second.score > 0 && Math.abs(top.score - second.score) <= 1);
  const confidence =
    top.score >= 4 && top.score - second.score >= 2
      ? "high"
      : top.score >= 2 && top.score - second.score >= 1
        ? "medium"
        : "low";

  if (inferredProject && projectScore >= 3 && projectScore + 1 >= learningScore) {
    return {
      section: "projects",
      project: inferredProject,
      confidence,
      ambiguous,
      reason: inferredProject ? "project-id-and-project-keywords" : "project-keywords",
      scores: {
        projects: projectScore,
        learnings: learningScore,
        domains: domainScore,
      },
      candidates: prioritizeCandidates("projects"),
    };
  }

  if (learningScore > 0 && learningScore >= domainScore) {
    return {
      section: "learnings",
      project: inferredProject,
      confidence,
      ambiguous,
      reason: "learning-keywords",
      scores: {
        projects: projectScore,
        learnings: learningScore,
        domains: domainScore,
      },
      candidates: prioritizeCandidates("learnings"),
    };
  }

  if (domainScore > 0 || sourceType === "url") {
    return {
      section: "domains",
      project: inferredProject,
      confidence,
      ambiguous,
      reason: sourceType === "url" && domainScore <= 1 ? "url-default" : "domain-keywords",
      scores: {
        projects: projectScore,
        learnings: learningScore,
        domains: domainScore,
      },
      candidates: prioritizeCandidates("domains"),
    };
  }

  return {
    section: inferredProject ? "projects" : "learnings",
    project: inferredProject,
    confidence,
    ambiguous: true,
    reason: inferredProject ? "project-fallback" : "default-learning-fallback",
    scores: {
      projects: projectScore,
      learnings: learningScore,
      domains: domainScore,
    },
    candidates: prioritizeCandidates(inferredProject ? "projects" : "learnings"),
  };
}

function normalizeGenericSourceName(sourceRef, fallbackSlug) {
  const trimmed = String(sourceRef ?? "").trim();
  if (!trimmed) {
    return `${fallbackSlug}.md`;
  }

  if (isLikelyUrl(trimmed)) {
    try {
      const url = new URL(trimmed);
      const pathname = url.pathname.replace(/\/+$/u, "");
      const leaf = pathname.split("/").filter(Boolean).pop();
      return leaf || url.hostname || `${fallbackSlug}.md`;
    } catch {
      return trimmed;
    }
  }

  return basename(trimmed) || `${fallbackSlug}.md`;
}

function buildGenericDocumentMeta({
  content,
  sourceRef,
  title = null,
  taskId = null,
  project = null,
  status = "",
  worker = "",
  qa = "",
  updatedDate = new Date().toISOString().slice(0, 10),
} = {}) {
  const parsed = parseFrontmatterDocument(String(content ?? ""));
  const body = parsed.body?.trim() ? parsed.body : String(content ?? "").trim();
  const normalizedSourceName = normalizeGenericSourceName(sourceRef, "note");
  const rawSourceSlug = sanitizeSlug(
    taskId ??
    title ??
    basename(normalizedSourceName, extname(normalizedSourceName)) ??
    sourceRef ??
    "note",
  );
  const fallbackTitle = humanizeSlug(taskId ?? rawSourceSlug);

  return {
    sourcePath: String(sourceRef ?? "").trim() || rawSourceSlug,
    sourceName: normalizeGenericSourceName(sourceRef, rawSourceSlug),
    sourceSlug: rawSourceSlug,
    taskId:
      String(
        taskId ??
        parsed.frontmatter.id ??
        parsed.frontmatter.task ??
        rawSourceSlug,
      ).trim(),
    project:
      typeof project === "string" && project.trim()
        ? project.trim()
        : typeof parsed.frontmatter.project === "string" && parsed.frontmatter.project.trim()
          ? parsed.frontmatter.project.trim()
          : inferProjectFromSourceName(rawSourceSlug),
    status:
      typeof status === "string" && status.trim()
        ? status.trim()
        : typeof parsed.frontmatter.status === "string"
          ? parsed.frontmatter.status.trim()
          : "",
    worker:
      typeof worker === "string" && worker.trim()
        ? worker.trim()
        : typeof parsed.frontmatter.worker === "string"
          ? parsed.frontmatter.worker.trim()
          : "",
    qa:
      typeof qa === "string" && qa.trim()
        ? qa.trim()
        : typeof parsed.frontmatter.qa === "string"
          ? parsed.frontmatter.qa.trim()
          : "",
    title: title ?? extractTitle(body, fallbackTitle),
    summary: extractSummary(body, fallbackTitle),
    body,
    updatedDate,
  };
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
  if (explicitSection === "projects" && project) {
    const slug = explicitSlug ?? sanitizeSlug(project);
    return {
      section: "projects",
      slug,
      relativePath: join("projects", `${slug}.md`),
    };
  }

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

async function ingestDocumentMeta({
  documentMeta,
  vaultDir,
  section = null,
  slug = null,
  page = null,
  title = null,
  dryRun = false,
  qaStatus = "passed",
  sourceLogLabel = null,
} = {}) {
  const activeVaultDir = vaultDir ?? resolveVaultDir();
  const routing = analyzeDocumentRouting({
    documentMeta,
    explicitSection: section,
    page,
    sourceType: isLikelyUrl(documentMeta?.sourcePath) ? "url" : "text",
  });
  const effectiveMeta = {
    ...documentMeta,
    project: routing.project ?? documentMeta?.project ?? null,
  };
  const target = inferTargetDescriptor(effectiveMeta, { section: routing.section, slug, page });
  const pagePath = join(activeVaultDir, target.relativePath);
  const candidateTargets = Array.isArray(routing.candidates)
    ? routing.candidates
      .map((candidate) => {
        if (!candidate?.section) {
          return null;
        }
        const candidateMeta = {
          ...effectiveMeta,
          project: candidate.project ?? effectiveMeta.project ?? null,
        };
        const candidateTarget = inferTargetDescriptor(candidateMeta, {
          section: candidate.section,
          slug,
          page,
        });
        return {
          section: candidate.section,
          score: candidate.score,
          project: candidate.project ?? candidateMeta.project ?? null,
          relativePath: candidateTarget.relativePath.replace(/\\/gu, "/"),
        };
      })
      .filter(Boolean)
    : [];

  await ensureVaultScaffold(activeVaultDir);
  await mkdir(join(activeVaultDir, target.section), { recursive: true });

  const existingContent = existsSync(pagePath) ? await readFile(pagePath, "utf8") : "";
  const existingPage = parsePageDocument(existingContent);
  const frontmatter = {
    title: String(existingPage.frontmatter.title ?? createPageTitle(target, effectiveMeta, title)),
    domain: String(
      existingPage.frontmatter.domain ??
      (target.section === "projects" ? (effectiveMeta.project ?? "projects") : target.section),
    ),
    tags: mergeTags(existingPage.frontmatter.tags, inferTags(effectiveMeta, target)),
    created: String(existingPage.frontmatter.created ?? effectiveMeta.updatedDate),
    updated: effectiveMeta.updatedDate,
    sources: mergeTags(existingPage.frontmatter.sources, [effectiveMeta.sourcePath]),
  };

  const detailsBlockId = sanitizeSlug(effectiveMeta.sourceName || effectiveMeta.sourceSlug || effectiveMeta.taskId);
  const nextSummary =
    String(existingPage.sections.get("Summary") ?? "").trim() &&
    !String(existingPage.sections.get("Summary") ?? "").trim().startsWith("(")
      ? String(existingPage.sections.get("Summary") ?? "").trim()
      : effectiveMeta.summary;

  const detailsUpdate = upsertDetailsSection(
    existingPage.sections.get("Details") ?? "",
    detailsBlockId,
    buildIngestBlock(effectiveMeta, qaStatus),
  );

  const nextSections = new Map();
  nextSections.set("Summary", nextSummary);
  nextSections.set("Details", detailsUpdate.content);
  nextSections.set(
    "Related",
    buildRelatedSection(existingPage.sections.get("Related") ?? "", target, effectiveMeta),
  );

  const pageContent = `${stringifyFrontmatter(frontmatter)}\n\n${formatSections(nextSections)}\n`;
  const relativePagePath = target.relativePath.replace(/\\/gu, "/");
  const operation = existsSync(pagePath) ? (detailsUpdate.action === "updated" ? "UPDATE" : "INGEST") : "CREATE";
  const logLabel = sourceLogLabel ?? documentMeta.sourceName ?? documentMeta.sourcePath;

  if (!dryRun) {
    await writeFile(pagePath, pageContent, "utf8");
    await rewriteIndex(activeVaultDir);
    await appendLogEntry(
      activeVaultDir,
      `${operation}: \`${logLabel}\` → \`${relativePagePath}\` (qa: ${qaStatus})`,
    );
  }

  return {
    action: operation,
    pagePath,
    relativePagePath,
    vaultDir: activeVaultDir,
    taskId: effectiveMeta.taskId,
    project: effectiveMeta.project,
    sourcePath: effectiveMeta.sourcePath,
    dryRun,
    routing: {
      ...routing,
      resolvedSection: target.section,
      resolvedProject: effectiveMeta.project ?? null,
      suggestedPath: relativePagePath,
      candidates: candidateTargets,
    },
  };
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

async function readVaultEntry(filePath, section, relativePathOverride) {
  const content = await readFile(filePath, "utf8");
  const parsed = parsePageDocument(content);
  const summary = String(parsed.sections.get("Summary") ?? "").trim() || extractSummary(parsed.body, basename(filePath, ".md"));
  const details = String(parsed.sections.get("Details") ?? "").trim();
  const related = String(parsed.sections.get("Related") ?? "").trim();

  return {
    section,
    filePath,
    relativePath: relativePathOverride ?? join(section, basename(filePath)),
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
      if (file.isDirectory()) {
        const subDir = join(sectionDir, file.name);
        const subFiles = await readdir(subDir, { withFileTypes: true });
        for (const subFile of subFiles) {
          if (!subFile.isFile() || extname(subFile.name).toLowerCase() !== ".md") {
            continue;
          }
          const relPath = `${section}/${file.name}/${subFile.name}`;
          entries.push(await readVaultEntry(join(subDir, subFile.name), section, relPath));
        }
        continue;
      }
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

function autoSubsectionLabel(subDirName) {
  return subDirName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function extractIndexStructure(indexContent) {
  const pathToSubsection = new Map();
  const subsectionOrder = new Map();
  if (!indexContent) {
    return { pathToSubsection, subsectionOrder };
  }

  const lines = normalizeLineEndings(indexContent).split("\n");
  let currentSection = null;
  let currentSubsection = null;

  for (const rawLine of lines) {
    const h2 = rawLine.match(/^##\s+(.+?)\s*$/u);
    if (h2) {
      currentSection = h2[1].trim();
      currentSubsection = null;
      if (!subsectionOrder.has(currentSection)) {
        subsectionOrder.set(currentSection, []);
      }
      continue;
    }
    const h3 = rawLine.match(/^###\s+(.+?)\s*$/u);
    if (h3 && currentSection) {
      currentSubsection = h3[1].trim();
      const order = subsectionOrder.get(currentSection);
      if (order && !order.includes(currentSubsection)) {
        order.push(currentSubsection);
      }
      continue;
    }
    const link = rawLine.match(/^-\s+\[[^\]]+\]\(([^)]+\.md)\)/u);
    if (link && currentSection) {
      const relPath = link[1].trim();
      pathToSubsection.set(relPath, currentSubsection);
    }
  }

  return { pathToSubsection, subsectionOrder };
}

export async function rewriteIndex(vaultDir) {
  const entries = await collectVaultEntries(vaultDir);
  const bySection = new Map(
    ["domains", "projects", "learnings", "inbox"].map((section) => [
      section,
      entries.filter((entry) => entry.section === section),
    ]),
  );

  const indexPath = join(vaultDir, "index.md");
  const existingContent = existsSync(indexPath)
    ? normalizeLineEndings(await readFile(indexPath, "utf8"))
    : "";
  const { pathToSubsection, subsectionOrder } = extractIndexStructure(existingContent);

  const lines = ["# Kuma Vault Index", ""];

  const formatEntry = (entry) => {
    const summary = entry.summary || "요약 없음";
    return `- [${entry.title}](${entry.relativePath.replace(/\\/gu, "/")}) — ${summary}`;
  };

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
      lines.push("");
      continue;
    }

    if (section === "inbox") {
      for (const entry of sectionEntries) {
        lines.push(formatEntry(entry));
      }
      lines.push("");
      continue;
    }

    const rootEntries = [];
    const bySubsection = new Map();
    const placeUnder = (label, entry) => {
      if (!bySubsection.has(label)) {
        bySubsection.set(label, []);
      }
      bySubsection.get(label).push(entry);
    };

    for (const entry of sectionEntries) {
      const relPath = entry.relativePath.replace(/\\/gu, "/");
      if (pathToSubsection.has(relPath)) {
        const mapped = pathToSubsection.get(relPath);
        if (mapped === null) {
          rootEntries.push(entry);
        } else {
          placeUnder(mapped, entry);
        }
        continue;
      }

      const parts = relPath.split("/");
      if (parts.length >= 3) {
        placeUnder(autoSubsectionLabel(parts[1]), entry);
      } else {
        rootEntries.push(entry);
      }
    }

    for (const entry of rootEntries) {
      lines.push(formatEntry(entry));
    }

    const preservedOrder = subsectionOrder.get(heading) ?? [];
    const emittedSubsections = new Set();
    const emitSubsection = (label) => {
      if (emittedSubsections.has(label)) return;
      const subEntries = bySubsection.get(label);
      if (!subEntries || subEntries.length === 0) return;
      emittedSubsections.add(label);
      lines.push("");
      lines.push(`### ${label}`);
      for (const entry of subEntries) {
        lines.push(formatEntry(entry));
      }
    };

    for (const label of preservedOrder) {
      emitSubsection(label);
    }
    const remaining = Array.from(bySubsection.keys())
      .filter((label) => !emittedSubsections.has(label))
      .sort((a, b) => a.localeCompare(b));
    for (const label of remaining) {
      emitSubsection(label);
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

async function findTaskMetadataById(taskId, taskDir) {
  if (!taskId || !taskDir || !existsSync(taskDir)) {
    return null;
  }

  const entries = await readdir(taskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".task.md")) {
      continue;
    }

    const fullPath = join(taskDir, entry.name);
    const content = await readFile(fullPath, "utf8");
    const metadata = parseTaskLikeMetadata(content);
    if (String(metadata.id ?? "").trim() === String(taskId).trim()) {
      return metadata;
    }
  }

  return null;
}

export async function resolveResultPathForTaskId(taskId, {
  taskDir = DEFAULT_DISPATCH_TASK_DIR,
  resultDir = DEFAULT_DISPATCH_RESULT_DIR,
  vaultDir = resolveVaultDir(),
} = {}) {
  const normalizedTaskId = String(taskId ?? "").trim();
  if (!normalizedTaskId) {
    throw new Error("taskId is required.");
  }

  const taskMetadata = await findTaskMetadataById(normalizedTaskId, taskDir);
  if (typeof taskMetadata?.result === "string" && taskMetadata.result.trim()) {
    const referenced = resolve(taskMetadata.result);
    if (existsSync(referenced)) {
      return referenced;
    }
  }

  const candidates = [
    join(resultDir, `${normalizedTaskId}.result.md`),
    join(vaultDir, "results", `${normalizedTaskId}.result.md`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }

  throw new Error(`Could not resolve result file for task id: ${normalizedTaskId}`);
}

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildVaultIngestStampKey(resultPath, mtimeMs) {
  return createHash("sha1")
    .update(`${resolve(resultPath)}:${Math.trunc(mtimeMs)}`)
    .digest("hex");
}

export async function ingestResultFileWithGuards({
  resultPath,
  signal = null,
  taskDir = DEFAULT_DISPATCH_TASK_DIR,
  stampDir = DEFAULT_VAULT_INGEST_STAMP_DIR,
  vaultDir,
  wikiDir,
  section = null,
  slug = null,
  page = null,
  title = null,
  dryRun = false,
} = {}) {
  const requestedResultPath = normalizeOptionalString(resultPath);
  if (!requestedResultPath) {
    return { status: "skipped", reason: "missing-result-path" };
  }

  const absoluteResultPath = resolve(requestedResultPath);
  if (!existsSync(absoluteResultPath)) {
    return { status: "skipped", reason: "missing-result-file", resultPath: absoluteResultPath };
  }

  const taskMetadata = await findMatchingTaskMetadata(absoluteResultPath, taskDir);
  if (!taskMetadata) {
    return { status: "skipped", reason: "missing-task-metadata", resultPath: absoluteResultPath };
  }

  const qaSurface = normalizeOptionalString(taskMetadata.qa);
  if (!qaSurface) {
    return {
      status: "skipped",
      reason: "task-has-no-qa",
      resultPath: absoluteResultPath,
      taskId: normalizeOptionalString(taskMetadata.id),
    };
  }

  const expectedSignal = normalizeOptionalString(taskMetadata.signal);
  const receivedSignal = normalizeOptionalString(signal);
  if (receivedSignal && expectedSignal && receivedSignal !== expectedSignal) {
    return {
      status: "skipped",
      reason: "signal-mismatch",
      resultPath: absoluteResultPath,
      taskId: normalizeOptionalString(taskMetadata.id),
      expectedSignal,
      receivedSignal,
    };
  }

  const resultStat = await stat(absoluteResultPath);
  const resolvedStampDir = resolve(stampDir);
  const stampPath = join(
    resolvedStampDir,
    `${buildVaultIngestStampKey(absoluteResultPath, resultStat.mtimeMs)}.json`,
  );

  if (existsSync(stampPath)) {
    return {
      status: "skipped",
      reason: "already-ingested",
      resultPath: absoluteResultPath,
      taskId: normalizeOptionalString(taskMetadata.id),
      stampPath,
    };
  }

  const ingest = await ingestResultFile({
    resultPath: absoluteResultPath,
    vaultDir,
    wikiDir,
    taskDir,
    qaStatus: "passed",
    section,
    slug,
    page,
    title,
    dryRun,
  });

  if (!dryRun) {
    await mkdir(resolvedStampDir, { recursive: true });
    await writeFile(
      stampPath,
      `${JSON.stringify(
        {
          status: "ingested",
          signal: receivedSignal || expectedSignal || null,
          resultPath: absoluteResultPath,
          taskId: normalizeOptionalString(taskMetadata.id) || ingest.taskId || null,
          ingestedAt: new Date().toISOString(),
          ingest,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return {
    status: "ingested",
    reason: null,
    resultPath: absoluteResultPath,
    taskId: normalizeOptionalString(taskMetadata.id) || ingest.taskId || null,
    stampPath,
    ingest,
  };
}

function extractTextFromHtml(html = "") {
  return normalizeLineEndings(String(html ?? ""))
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<\/?(main|article|section|p|div|li|h[1-6]|br|tr|td|th|blockquote)[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

async function readUrlAsIngestText(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/markdown,text/plain,text/html,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": "kuma-studio/vault-ingest",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL for vault-ingest: ${url} (${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (contentType.includes("text/html")) {
    return extractTextFromHtml(raw);
  }

  return raw.trim();
}

export async function ingestGenericSource({
  source,
  sourceType = null,
  vaultDir,
  taskDir = DEFAULT_DISPATCH_TASK_DIR,
  section = null,
  slug = null,
  page = null,
  title = null,
  project = null,
  qaStatus = "passed",
  dryRun = false,
} = {}) {
  const activeVaultDir = vaultDir ?? resolveVaultDir();
  const normalizedSource = String(source ?? "").trim();
  if (!normalizedSource) {
    throw new Error("source is required.");
  }

  let effectiveSourceType = sourceType;
  if (!effectiveSourceType) {
    if (isLikelyUrl(normalizedSource)) {
      effectiveSourceType = "url";
    } else if (existsSync(resolve(normalizedSource))) {
      effectiveSourceType = "file";
    } else {
      effectiveSourceType = "text";
    }
  }

  if (effectiveSourceType === "file") {
    const resolvedPath = resolve(normalizedSource);
    const content = await readFile(resolvedPath, "utf8");
    const documentMeta = buildGenericDocumentMeta({
      content,
      sourceRef: resolvedPath,
      title,
      project,
    });
    return ingestDocumentMeta({
      documentMeta,
      vaultDir: activeVaultDir,
      section,
      slug,
      page,
      title,
      dryRun,
      qaStatus,
      sourceLogLabel: basename(resolvedPath),
    });
  }

  if (effectiveSourceType === "url") {
    const content = await readUrlAsIngestText(normalizedSource);
    const documentMeta = buildGenericDocumentMeta({
      content,
      sourceRef: normalizedSource,
      title,
      project,
    });
    return ingestDocumentMeta({
      documentMeta,
      vaultDir: activeVaultDir,
      section,
      slug,
      page,
      title,
      dryRun,
      qaStatus,
      sourceLogLabel: normalizedSource,
    });
  }

  const documentMeta = buildGenericDocumentMeta({
    content: normalizedSource,
    sourceRef: `text:${sanitizeSlug(slug ?? title ?? normalizedSource.slice(0, 40) ?? "note")}`,
    title,
    taskId: slug ?? null,
    project,
  });
  return ingestDocumentMeta({
    documentMeta,
    vaultDir: activeVaultDir,
    section,
    slug,
    page,
    title,
    dryRun,
    qaStatus,
    sourceLogLabel: "inline-text",
  });
}

export async function ingestInbox({
  vaultDir,
  taskDir = DEFAULT_DISPATCH_TASK_DIR,
  section = null,
  qaStatus = "passed",
  dryRun = false,
  routeResolver = null,
} = {}) {
  const activeVaultDir = vaultDir ?? resolveVaultDir();
  const inboxDir = join(activeVaultDir, "inbox");
  await ensureVaultScaffold(activeVaultDir);

  if (!existsSync(inboxDir)) {
    return { action: "NONE", vaultDir: activeVaultDir, processed: [] };
  }

  const entries = await readdir(inboxDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => !entry.name.endsWith(".done"))
    .filter((entry) => INGESTIBLE_INBOX_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name));

  const processed = [];

  for (const entry of candidates) {
    const originalPath = join(inboxDir, entry.name);
    const archivedPath = `${originalPath}.done`;
    const content = await readFile(originalPath, "utf8");
    const previewDocumentMeta = buildGenericDocumentMeta({
      content,
      sourceRef: originalPath,
      taskId: basename(entry.name, extname(entry.name)),
      project: null,
    });
    const preview = await ingestDocumentMeta({
      documentMeta: previewDocumentMeta,
      vaultDir: activeVaultDir,
      section,
      slug: null,
      page: null,
      title: null,
      dryRun: true,
      qaStatus,
      sourceLogLabel: entry.name,
    });
    const override = typeof routeResolver === "function"
      ? await routeResolver({
        entryName: entry.name,
        documentMeta,
        preview,
      })
      : null;
    if (override?.skip === true) {
      processed.push({
        action: "SKIP",
        vaultDir: activeVaultDir,
        sourcePath: originalPath,
        relativePagePath: null,
        routing: preview.routing,
      });
      continue;
    }

    const sourcePath = dryRun ? originalPath : archivedPath;
    if (!dryRun) {
      await rename(originalPath, archivedPath);
    }
    const documentMeta = buildGenericDocumentMeta({
      content,
      sourceRef: sourcePath,
      taskId: basename(entry.name, extname(entry.name)),
      project: null,
    });
    const ingestResult = await ingestDocumentMeta({
      documentMeta,
      vaultDir: activeVaultDir,
      section: override?.section ?? section,
      slug: override?.slug ?? null,
      page: override?.page ?? null,
      title: null,
      dryRun,
      qaStatus,
      sourceLogLabel: entry.name,
    });
    processed.push({
      ...ingestResult,
      inboxPath: originalPath,
      archivedInboxPath: sourcePath,
    });
  }

  return {
    action: processed.length > 0 ? "INGEST_BATCH" : "NONE",
    vaultDir: activeVaultDir,
    processed,
    dryRun,
  };
}

export async function ingestResultFile({
  resultPath,
  vaultDir,
  wikiDir,
  taskDir = DEFAULT_DISPATCH_TASK_DIR,
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
  return ingestDocumentMeta({
    documentMeta: resultMeta,
    vaultDir: activeVaultDir,
    section,
    slug,
    page,
    title,
    dryRun,
    qaStatus,
    sourceLogLabel: basename(resolvedResultPath),
  });
}
