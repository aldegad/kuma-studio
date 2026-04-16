import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

import { resolveVaultDir } from "./memo-store.mjs";
import {
  appendLogEntry,
  detectUnindexedDomainPages,
  ensureVaultScaffold,
  extractFrontmatterSources,
  parseFrontmatterDocument,
  rewriteIndex,
  stringifyFrontmatter,
} from "./vault-ingest.mjs";

const SKILL_DOC_FILE_NAMES = new Set(["skill.md"]);
const SOURCE_PREFIX = "skills/";
const SKIP_DIR_NAMES = new Set([".git", "node_modules", ".DS_Store"]);

export const SKILL_DOMAIN_PAGE_MAP = new Map([
  ["usage-insights", "domains/analytics.md"],
  ["image-gen", "domains/image-generation.md"],
  ["nano-banana", "domains/image-generation.md"],
  ["gateproof-kisa-check", "domains/security.md"],
  ["gateproof-full-security-check", "domains/security.md"],
  ["security-threat-intel", "domains/security.md"],
  ["content-pipeline", "domains/content-pipeline.md"],
  ["kuma-vault", "domains/kuma-vault.md"],
]);

function normalizeSkillKey(value) {
  return String(value ?? "")
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .replace(/\/+/gu, "/")
    .trim();
}

function skillSlugFromKey(skillKey) {
  return normalizeSkillKey(skillKey).replace(/\//gu, "--") || "unnamed-skill";
}

function titleizeSkillKey(skillKey) {
  return normalizeSkillKey(skillKey)
    .split("/")
    .pop()
    ?.replace(/[-_]+/gu, " ")
    .trim() || "Skill";
}

function extractSkillTitle(content, fallback) {
  const parsed = parseFrontmatterDocument(content);
  if (typeof parsed.frontmatter.title === "string" && parsed.frontmatter.title.trim()) {
    return parsed.frontmatter.title.trim();
  }

  const firstHeading = parsed.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+.+$/u.test(line));

  if (firstHeading) {
    return firstHeading.replace(/^#\s+/u, "").trim();
  }

  return fallback;
}

export function resolveSkillsDir() {
  if (process.env.KUMA_SKILLS_DIR) {
    return resolve(process.env.KUMA_SKILLS_DIR);
  }

  return resolve(homedir(), ".claude", "skills");
}

async function walkSkillDocuments(rootDir, currentDir = rootDir) {
  if (!existsSync(currentDir)) {
    return [];
  }

  const entries = await readdir(currentDir, { withFileTypes: true });
  const matches = [];

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      matches.push(...await walkSkillDocuments(rootDir, fullPath));
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    if (!SKILL_DOC_FILE_NAMES.has(entry.name.toLowerCase())) {
      continue;
    }

    const skillDir = dirname(fullPath);
    const skillKey = normalizeSkillKey(relative(rootDir, skillDir));
    if (!skillKey || skillKey.startsWith("..")) {
      continue;
    }

    matches.push({
      skillKey,
      sourcePath: fullPath,
      sourceRef: `${SOURCE_PREFIX}${skillKey}`,
    });
  }

  return matches.sort((left, right) => left.skillKey.localeCompare(right.skillKey));
}

function buildManagedSkillDocument({ content, skillKey, sourcePath, sourceUpdatedAt, mappedDomainPath }) {
  const parsed = parseFrontmatterDocument(content);
  const body = parsed.body.trim() || String(content ?? "").trim();
  const frontmatter = {
    ...parsed.frontmatter,
    title: extractSkillTitle(content, titleizeSkillKey(skillKey)),
    source: `${SOURCE_PREFIX}${skillKey}`,
    sourcePath,
    sourceUpdatedAt,
  };

  if (mappedDomainPath) {
    frontmatter.migrated_to = mappedDomainPath;
  }

  return `${stringifyFrontmatter(frontmatter)}\n\n${body}\n`;
}

async function readManagedInboxMap(inboxDir) {
  if (!existsSync(inboxDir)) {
    return new Map();
  }

  const entries = await readdir(inboxDir, { withFileTypes: true });
  const managed = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }

    const filePath = join(inboxDir, entry.name);
    const content = await readFile(filePath, "utf8");
    const parsed = parseFrontmatterDocument(content);
    const source = typeof parsed.frontmatter.source === "string" ? parsed.frontmatter.source.trim() : "";
    if (!source.startsWith(SOURCE_PREFIX)) {
      continue;
    }

    managed.set(source, {
      filePath,
      content,
      frontmatter: parsed.frontmatter,
    });
  }

  return managed;
}

async function syncSkillInboxFiles({ skillsDir, vaultDir, now }) {
  const inboxDir = join(vaultDir, "inbox");
  await mkdir(inboxDir, { recursive: true });

  const skillDocs = await walkSkillDocuments(skillsDir);
  const existingManaged = await readManagedInboxMap(inboxDir);
  const seenSources = new Set();

  let created = 0;
  let updated = 0;

  const syncedSkills = [];

  for (const skillDoc of skillDocs) {
    const sourceStat = await stat(skillDoc.sourcePath);
    const sourceUpdatedAt = sourceStat.mtime.toISOString();
    const mappedDomainPath = SKILL_DOMAIN_PAGE_MAP.get(skillDoc.skillKey) ?? null;
    const nextContent = buildManagedSkillDocument({
      content: await readFile(skillDoc.sourcePath, "utf8"),
      skillKey: skillDoc.skillKey,
      sourcePath: skillDoc.sourcePath,
      sourceUpdatedAt,
      mappedDomainPath,
    });
    const fileName = `${skillSlugFromKey(skillDoc.skillKey)}.md`;
    const inboxPath = join(inboxDir, fileName);
    const previous = existingManaged.get(skillDoc.sourceRef);

    if (!previous) {
      created += 1;
      await writeFile(inboxPath, nextContent, "utf8");
    } else if (previous.content !== nextContent || previous.filePath !== inboxPath) {
      updated += 1;
      await writeFile(inboxPath, nextContent, "utf8");
      if (previous.filePath !== inboxPath && existsSync(previous.filePath)) {
        await rm(previous.filePath, { force: true });
      }
    }

    seenSources.add(skillDoc.sourceRef);
    syncedSkills.push({
      ...skillDoc,
      inboxPath,
      inboxRelativePath: `inbox/${fileName}`,
      mappedDomainPath,
    });
  }

  let deleted = 0;
  for (const [sourceRef, previous] of existingManaged.entries()) {
    if (seenSources.has(sourceRef)) {
      continue;
    }

    await rm(previous.filePath, { force: true });
    deleted += 1;
  }

  return {
    syncedSkills,
    created,
    updated,
    deleted,
  };
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

async function alignDomainSources({ vaultDir, syncedSkills, now }) {
  const grouped = new Map();

  for (const skill of syncedSkills) {
    if (!skill.mappedDomainPath) {
      continue;
    }

    const current = grouped.get(skill.mappedDomainPath) ?? [];
    current.push(skill.sourcePath);
    grouped.set(skill.mappedDomainPath, current);
  }

  let domainPagesUpdated = 0;
  let dedupedSources = 0;
  const warnings = [];

  for (const [relativePath, nextSourcePaths] of grouped.entries()) {
    const fullPath = join(vaultDir, relativePath);
    if (!existsSync(fullPath)) {
      warnings.push(`Mapped domain page missing: ${relativePath}`);
      continue;
    }

    const existingContent = await readFile(fullPath, "utf8");
    const parsed = parseFrontmatterDocument(existingContent);
    const currentSources = extractFrontmatterSources(parsed.frontmatter);
    const uniqueCurrentSources = uniqueStrings(currentSources);
    const mergedSources = uniqueStrings([...uniqueCurrentSources, ...nextSourcePaths]);

    dedupedSources += currentSources.length - uniqueCurrentSources.length;
    dedupedSources += uniqueCurrentSources.length + nextSourcePaths.length - mergedSources.length;

    if (mergedSources.length === currentSources.length && mergedSources.every((value, index) => value === currentSources[index])) {
      continue;
    }

    const nextFrontmatter = {
      ...parsed.frontmatter,
      sources: mergedSources,
      updated: now.toISOString().slice(0, 10),
    };
    delete nextFrontmatter.source;
    delete nextFrontmatter.sourcePath;

    await writeFile(fullPath, `${stringifyFrontmatter(nextFrontmatter)}\n\n${parsed.body.trim()}\n`, "utf8");
    domainPagesUpdated += 1;
  }

  return {
    domainPagesUpdated,
    dedupedSources,
    warnings,
  };
}

export async function syncVaultSkills({
  vaultDir = resolveVaultDir(),
  skillsDir = resolveSkillsDir(),
  now = new Date(),
} = {}) {
  const activeVaultDir = resolve(vaultDir);
  const activeSkillsDir = resolve(skillsDir);

  await ensureVaultScaffold(activeVaultDir);
  const orphanedDomains = await detectUnindexedDomainPages(activeVaultDir);

  const syncResult = await syncSkillInboxFiles({
    skillsDir: activeSkillsDir,
    vaultDir: activeVaultDir,
    now,
  });
  const alignmentResult = await alignDomainSources({
    vaultDir: activeVaultDir,
    syncedSkills: syncResult.syncedSkills,
    now,
  });

  await rewriteIndex(activeVaultDir);

  const warnings = [
    ...orphanedDomains.map((relativePath) => `Orphan domain page auto-indexed: ${relativePath}`),
    ...alignmentResult.warnings,
  ];

  await appendLogEntry(
    activeVaultDir,
    `SYNC_SKILLS: ${syncResult.syncedSkills.length} skills (${syncResult.created} created, ${syncResult.updated} updated, ${syncResult.deleted} deleted, domain updates: ${alignmentResult.domainPagesUpdated})`,
  );
  for (const warning of warnings) {
    await appendLogEntry(activeVaultDir, `WARN: ${warning}`);
  }

  return {
    skillsDir: activeSkillsDir,
    vaultDir: activeVaultDir,
    skillsSynced: syncResult.syncedSkills.length,
    created: syncResult.created,
    updated: syncResult.updated,
    deleted: syncResult.deleted,
    domainPagesUpdated: alignmentResult.domainPagesUpdated,
    dedupedSources: alignmentResult.dedupedSources,
    orphanWarnings: orphanedDomains,
    warnings,
  };
}
