import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { resolveVaultDir } from "./memo-store.mjs";

export const DEFAULT_SPECIAL_VAULT_FILES = Object.freeze([
  "dispatch-log.md",
  "decisions.md",
]);

export const SPECIAL_VAULT_FILE_SPECS = Object.freeze({
  "dispatch-log.md": {
    frontmatter: {
      title: { type: "string", exact: "Dispatch Log" },
      type: { type: "string", exact: "special/dispatch-log" },
      updated: { type: "iso-datetime" },
      entry_format: { type: "string", exact: "append-only-ledger" },
      source_of_truth: { type: "string", exact: "kuma-dispatch-lifecycle" },
      boot_priority: { type: "integer", exact: 1 },
    },
    requiredSections: ["Entries"],
    schemaType: "special/dispatch-log",
    schemaWriter: "kuma-dispatch lifecycle hook",
    structuralChecks: ["ledger"],
  },
  "decisions.md": {
    frontmatter: {
      title: { type: "string", exact: "Decisions" },
      type: { type: "string", exact: "special/decisions" },
      updated: { type: "iso-datetime" },
      entry_rule: { type: "string", exact: "explicit-user-decision-only" },
      source_of_truth: { type: "string", exact: "user-direct" },
      boot_priority: { type: "integer", exact: 3 },
    },
    requiredSections: ["About", "Decisions"],
    schemaType: "special/decisions",
    schemaWriter: "user-direct",
    structuralChecks: [],
  },
});

const PLACEHOLDER_PATTERN = /^\(.*\)$/su;
const LEDGER_LINE_PATTERN = /^- \d{4}-\d{2}-\d{2}T[^|]+\| .+/u;
const SECTION_HEADING_PATTERN = /^##\s+/u;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/gu;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ARRAY_LITERAL_PATTERN = /^\[.*\]$/su;
const RESULT_SOURCE_PATTERN = /(?:^|\/)results\/[^/]+\.result\.md$|\.result\.md$/u;
const RESULT_ARCHIVE_FILE_PATTERN = /^results\/.+\.result\.md$/u;

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseFrontmatter(contents) {
  const lines = String(contents ?? "").replace(/\r/gu, "").split("\n");
  if (lines[0] !== "---") {
    return null;
  }

  const frontmatter = {};
  let currentArrayKey = null;
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") {
      index += 1;
      break;
    }

    const arrayItem = line.match(/^\s*-\s*(.+)$/u);
    if (currentArrayKey && arrayItem) {
      frontmatter[currentArrayKey].push(arrayItem[1].trim());
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      currentArrayKey = null;
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value === "") {
      frontmatter[key] = [];
      currentArrayKey = key;
      continue;
    }

    currentArrayKey = null;
    frontmatter[key] = value;
  }

  if (index > lines.length) {
    return null;
  }

  return {
    frontmatter,
    body: lines.slice(index).join("\n").replace(/^\n+/u, ""),
  };
}

function parseSections(body) {
  const sections = {};
  const lines = String(body ?? "").replace(/\r/gu, "").split("\n");
  let currentTitle = "";
  let buffer = [];

  function flush() {
    if (!currentTitle) return;
    sections[currentTitle] = buffer.join("\n").replace(/^\n+/u, "").replace(/\n+$/u, "");
  }

  for (const line of lines) {
    if (SECTION_HEADING_PATTERN.test(line)) {
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

function parseLedgerLines(sectionText) {
  const text = normalize(sectionText);
  if (!text || PLACEHOLDER_PATTERN.test(text)) {
    return [];
  }

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

function parseInlineArray(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!ARRAY_LITERAL_PATTERN.test(value)) {
    return [];
  }

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

function isProjectSummaryPage(fileName) {
  return fileName.startsWith("projects/") && !fileName.endsWith(".project-decisions.md");
}

function isMemoPage(fileName) {
  return fileName.startsWith("memos/");
}

function isResultArchivePage(fileName) {
  return RESULT_ARCHIVE_FILE_PATTERN.test(fileName);
}

function isProjectDecisionPage(fileName) {
  return /^projects\/[^/]+\.project-decisions\.md$/u.test(fileName);
}

function isTopLevelDomainPage(fileName) {
  return /^domains\/[^/]+\.md$/u.test(fileName);
}

function isOperationalRulePage(fileName) {
  return /^operational-rules\/[^/]+\.md$/u.test(fileName);
}

function isNestedReferenceDocPage(fileName) {
  return (
    fileName.startsWith("docs/") ||
    /^domains\/[^/]+\/.+\.md$/u.test(fileName) ||
    /^projects\/[^/]+\/.+\.md$/u.test(fileName)
  );
}

function normalizeRequestedFiles(files) {
  if (!files) {
    return [...DEFAULT_SPECIAL_VAULT_FILES];
  }

  const rawItems = Array.isArray(files)
    ? files
    : String(files)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  if (rawItems.length === 0) {
    return [...DEFAULT_SPECIAL_VAULT_FILES];
  }

  return [...new Set(rawItems.map((item) => {
    const normalizedPath = item.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
    if (!normalizedPath.endsWith(".md")) {
      throw new Error(`Unsupported vault file: ${item}`);
    }
    return normalizedPath;
  }))];
}

function isIsoDateTime(value) {
  return Boolean(value) && /\d{4}-\d{2}-\d{2}T/u.test(value) && !Number.isNaN(Date.parse(value));
}

function isIsoDate(value) {
  return ISO_DATE_PATTERN.test(String(value ?? "").trim()) && !Number.isNaN(Date.parse(`${String(value).trim()}T00:00:00Z`));
}

function validateFrontmatterValue(fileName, key, rule, rawValue) {
  const value = normalize(rawValue);
  if (!value) {
    return {
      code: "missing-frontmatter-field",
      message: `${fileName}: missing frontmatter field "${key}"`,
    };
  }

  if (rule.type === "string") {
    if (rule.exact && value !== String(rule.exact)) {
      return {
        code: "frontmatter-value-mismatch",
        message: `${fileName}: expected ${key}=${rule.exact}, received ${value}`,
      };
    }
    return null;
  }

  if (rule.type === "iso-datetime") {
    if (!isIsoDateTime(value)) {
      return {
        code: "frontmatter-type-mismatch",
        message: `${fileName}: frontmatter "${key}" must be an ISO datetime`,
      };
    }
    return null;
  }

  if (rule.type === "integer") {
    const numeric = Number(value);
    if (!Number.isInteger(numeric)) {
      return {
        code: "frontmatter-type-mismatch",
        message: `${fileName}: frontmatter "${key}" must be an integer`,
      };
    }
    if (rule.min != null && numeric < rule.min) {
      return {
        code: "frontmatter-value-mismatch",
        message: `${fileName}: frontmatter "${key}" must be >= ${rule.min}`,
      };
    }
    if (rule.exact != null && numeric !== rule.exact) {
      return {
        code: "frontmatter-value-mismatch",
        message: `${fileName}: expected ${key}=${rule.exact}, received ${numeric}`,
      };
    }
    return null;
  }

  return {
    code: "unsupported-rule",
    message: `${fileName}: unsupported lint rule for "${key}"`,
  };
}

function collectMarkdownLinks(contents) {
  const links = [];
  for (const match of String(contents ?? "").matchAll(MARKDOWN_LINK_PATTERN)) {
    const rawTarget = normalize(match[1]);
    if (!rawTarget) {
      continue;
    }
    links.push(rawTarget);
  }
  return links;
}

function isExternalLink(target) {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("obsidian://") ||
    target.startsWith("#")
  );
}

function cleanLinkTarget(target) {
  return target
    .replace(/\s+".*"$/u, "")
    .replace(/\s+'.*'$/u, "")
    .split("#")[0]
    .trim();
}

const SPECIAL_FILES_HEADING_PATTERN = /^## Special Files(?:\s*\([^)]+\))?\s*$/mu;

function extractSchemaSections(schemaContents) {
  const specialMatch = schemaContents.match(SPECIAL_FILES_HEADING_PATTERN);
  if (!specialMatch) {
    return {};
  }

  const specialSlice = schemaContents.slice(specialMatch.index);
  const sections = {};
  let currentFile = null;
  let buffer = [];

  function flush() {
    if (!currentFile) {
      return;
    }
    sections[currentFile] = buffer.join("\n").trim();
  }

  for (const line of specialSlice.split("\n")) {
    const headingMatch = line.match(/^### \d+\) `([^`]+)`$/u);
    if (headingMatch) {
      flush();
      currentFile = headingMatch[1];
      buffer = [];
      continue;
    }

    if (currentFile && /^## /u.test(line)) {
      flush();
      currentFile = null;
      buffer = [];
      break;
    }

    if (currentFile) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

function lintSchemaRegistration(fileName, spec, schemaSections) {
  const section = schemaSections[fileName];
  if (!section) {
    return [{
      code: "schema-missing-file",
      message: `${fileName}: schema.md is missing the ${fileName} special-file section`,
    }];
  }

  const issues = [];

  if (!section.includes(`type: ${spec.schemaType}`)) {
    issues.push({
      code: "schema-type-mismatch",
      message: `${fileName}: schema.md does not declare type: ${spec.schemaType}`,
    });
  }

  if (!section.includes(spec.schemaWriter)) {
    issues.push({
      code: "schema-writer-mismatch",
      message: `${fileName}: schema.md does not declare primary writer "${spec.schemaWriter}"`,
    });
  }

  return issues;
}

function lintStructuralRules(fileName, spec, sections) {
  const issues = [];

  if (spec.structuralChecks.includes("ledger")) {
    const lines = parseLedgerLines(sections["Entries"]);
    for (const line of lines) {
      if (!LEDGER_LINE_PATTERN.test(line)) {
        issues.push({
          code: "ledger-line-invalid",
          message: `${fileName}: invalid ledger line "${line}"`,
        });
      }
    }
  }

  return issues;
}

function lintRelativeLinks(fileName, absolutePath, contents) {
  const issues = [];
  for (const rawTarget of collectMarkdownLinks(contents)) {
    if (isExternalLink(rawTarget)) {
      continue;
    }

    const target = cleanLinkTarget(rawTarget);
    if (!target) {
      continue;
    }

    const resolvedTarget = resolve(dirname(absolutePath), target);
    if (!existsSync(resolvedTarget)) {
      issues.push({
        code: "broken-link",
        message: `${fileName}: linked file does not exist: ${rawTarget}`,
      });
    }
  }
  return issues;
}

function lintProjectPageCanonicalDrift(fileName, parsed) {
  const issues = [];

  if (!isProjectSummaryPage(fileName)) {
    return issues;
  }

  if (String(parsed.body ?? "").includes("<!-- ingest:")) {
    issues.push({
      code: "project-ingest-marker",
      message: `${fileName}: project summary pages must not contain legacy ingest marker blocks`,
    });
  }

  const resultSources = parseInlineArray(parsed.frontmatter.sources)
    .filter((source) => RESULT_SOURCE_PATTERN.test(String(source ?? "").trim().replace(/\\/gu, "/")));
  if (resultSources.length > 0) {
    issues.push({
      code: "project-result-sources",
      message: `${fileName}: project summary pages must not keep result archives in frontmatter.sources`,
    });
  }

  return issues;
}

function scanCanonicalDrift(vaultDir) {
  const issues = [];

  const projectsDir = join(vaultDir, "projects");
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.endsWith(".project-decisions.md")) {
        continue;
      }

      const relativePath = `projects/${entry.name}`;
      const absolutePath = join(projectsDir, entry.name);
      const parsed = parseFrontmatter(readFileSync(absolutePath, "utf8"));
      if (!parsed) {
        continue;
      }
      issues.push(...lintProjectPageCanonicalDrift(relativePath, parsed).map((issue) => ({
        file: relativePath,
        ...issue,
      })));
    }
  }

  const inboxDir = join(vaultDir, "inbox");
  if (existsSync(inboxDir)) {
    for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const relativePath = `inbox/${entry.name}`;
      const absolutePath = join(inboxDir, entry.name);
      const parsed = parseFrontmatter(readFileSync(absolutePath, "utf8"));
      if (!parsed) {
        continue;
      }

      const source = normalize(parsed.frontmatter.source).replace(/\\/gu, "/");
      if (!source.startsWith("skills/")) {
        continue;
      }

      issues.push({
        file: relativePath,
        code: "managed-skill-inbox",
        message: `${relativePath}: managed skill documents must not be staged in inbox/`,
      });
    }
  }

  const legacyRawMemosDir = join(vaultDir, "raw", "memos");
  if (existsSync(legacyRawMemosDir)) {
    const legacyEntries = readdirSync(legacyRawMemosDir, { withFileTypes: true });
    const hasLegacyMemoFiles = legacyEntries.some((entry) => entry.isFile() && entry.name.endsWith(".md"));
    const imagesEntry = legacyEntries.find((entry) => entry.isDirectory() && entry.name === "images");
    const hasLegacyMemoImages =
      Boolean(imagesEntry) &&
      readdirSync(join(legacyRawMemosDir, "images"), { withFileTypes: true })
        .some((entry) => entry.isFile());

    if (hasLegacyMemoFiles || hasLegacyMemoImages) {
      issues.push({
        file: "raw/memos",
        code: "legacy-raw-memos",
        message: "raw/memos: legacy memo artifacts must be migrated into memos/ and images/",
      });
    }
  }

  return issues;
}

function scanSpecialFileSetMismatch(schemaSections) {
  const runtimeFiles = new Set(DEFAULT_SPECIAL_VAULT_FILES);
  const schemaFiles = new Set(Object.keys(schemaSections ?? {}));
  const missingFromSchema = [...runtimeFiles].filter((fileName) => !schemaFiles.has(fileName));
  const extraInSchema = [...schemaFiles].filter((fileName) => !runtimeFiles.has(fileName));

  if (missingFromSchema.length === 0 && extraInSchema.length === 0) {
    return [];
  }

  const fragments = [];
  if (missingFromSchema.length > 0) {
    fragments.push(`missing in schema: ${missingFromSchema.sort((a, b) => a.localeCompare(b)).join(", ")}`);
  }
  if (extraInSchema.length > 0) {
    fragments.push(`unknown in schema: ${extraInSchema.sort((a, b) => a.localeCompare(b)).join(", ")}`);
  }

  return [{
    file: "schema.md",
    code: "schema-runtime-special-file-mismatch",
    message: `schema.md: special-file set diverges from runtime canonical set (${fragments.join("; ")})`,
  }];
}

function lintGenericPage(fileName, absolutePath, mode) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(contents);
  if (!parsed) {
    return {
      file: fileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-frontmatter",
        message: `${fileName}: YAML frontmatter is missing or malformed`,
      }],
    };
  }

  const frontmatter = parsed.frontmatter;
  if (!normalize(frontmatter.title)) {
    issues.push({
      code: "missing-frontmatter-title",
      message: `${fileName}: frontmatter.title is required`,
    });
  }
  if (!normalize(frontmatter.domain)) {
    issues.push({
      code: "missing-frontmatter-domain",
      message: `${fileName}: frontmatter.domain is required`,
    });
  }
  if (!ARRAY_LITERAL_PATTERN.test(String(frontmatter.tags ?? "").trim())) {
    issues.push({
      code: "frontmatter-tags-format",
      message: `${fileName}: frontmatter.tags must use inline array syntax`,
    });
  }
  if (!isIsoDate(frontmatter.created)) {
    issues.push({
      code: "frontmatter-created-format",
      message: `${fileName}: frontmatter.created must be YYYY-MM-DD`,
    });
  }
  if (!isIsoDate(frontmatter.updated)) {
    issues.push({
      code: "frontmatter-updated-format",
      message: `${fileName}: frontmatter.updated must be YYYY-MM-DD`,
    });
  }
  if (
    normalize(frontmatter.sources) &&
    !(
      Array.isArray(frontmatter.sources) ||
      ARRAY_LITERAL_PATTERN.test(String(frontmatter.sources ?? "").trim())
    )
  ) {
    issues.push({
      code: "frontmatter-sources-format",
      message: `${fileName}: frontmatter.sources must use inline array syntax`,
    });
  }

  const sections = parseSections(parsed.body);
  for (const section of ["Summary", "Details", "Related"]) {
    if (!Object.prototype.hasOwnProperty.call(sections, section)) {
      issues.push({
        code: "missing-section",
        message: `${fileName}: missing required section "## ${section}"`,
      });
    }
  }

  if (mode === "full") {
    issues.push(...lintProjectPageCanonicalDrift(fileName, parsed));
    issues.push(...lintRelativeLinks(fileName, absolutePath, parsed.body));
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintMemoPage(fileName, absolutePath, mode) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(contents);
  if (!parsed) {
    return {
      file: fileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-frontmatter",
        message: `${fileName}: YAML frontmatter is missing or malformed`,
      }],
    };
  }

  const frontmatter = parsed.frontmatter;
  if (!normalize(frontmatter.title)) {
    issues.push({
      code: "missing-frontmatter-title",
      message: `${fileName}: frontmatter.title is required`,
    });
  }
  if (!isIsoDateTime(frontmatter.created)) {
    issues.push({
      code: "frontmatter-created-format",
      message: `${fileName}: frontmatter.created must be an ISO datetime`,
    });
  }
  if (!isIsoDateTime(frontmatter.updated)) {
    issues.push({
      code: "frontmatter-updated-format",
      message: `${fileName}: frontmatter.updated must be an ISO datetime`,
    });
  }
  if (
    !(
      Array.isArray(frontmatter.images) ||
      ARRAY_LITERAL_PATTERN.test(String(frontmatter.images ?? "").trim())
    )
  ) {
    issues.push({
      code: "frontmatter-images-format",
      message: `${fileName}: frontmatter.images must be an array`,
    });
  }

  if (mode === "full") {
    issues.push(...lintRelativeLinks(fileName, absolutePath, parsed.body));
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintManagedSkillPage(fileName, absolutePath) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(contents);
  if (!parsed) {
    return {
      file: fileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-frontmatter",
        message: `${fileName}: YAML frontmatter is missing or malformed`,
      }],
    };
  }

  const frontmatter = parsed.frontmatter;
  if (!normalize(frontmatter.title)) {
    issues.push({
      code: "missing-frontmatter-title",
      message: `${fileName}: managed skill pages require frontmatter.title`,
    });
  }
  if (!normalize(frontmatter.source).startsWith("skills/")) {
    issues.push({
      code: "managed-skill-source",
      message: `${fileName}: managed skill pages require frontmatter.source starting with "skills/"`,
    });
  }
  if (!normalize(frontmatter.sourcePath)) {
    issues.push({
      code: "managed-skill-source-path",
      message: `${fileName}: managed skill pages require frontmatter.sourcePath`,
    });
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintOperationalRulePage(fileName, absolutePath, mode) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(contents);
  if (!parsed) {
    return {
      file: fileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-frontmatter",
        message: `${fileName}: YAML frontmatter is missing or malformed`,
      }],
    };
  }

  const frontmatter = parsed.frontmatter;
  if (!normalize(frontmatter.title)) {
    issues.push({
      code: "missing-frontmatter-title",
      message: `${fileName}: frontmatter.title is required`,
    });
  }
  if (!ARRAY_LITERAL_PATTERN.test(String(frontmatter.tags ?? "").trim())) {
    issues.push({
      code: "frontmatter-tags-format",
      message: `${fileName}: frontmatter.tags must use inline array syntax`,
    });
  }

  const lastVerified = normalize(frontmatter.last_verified);
  const updated = normalize(frontmatter.updated);
  if (!lastVerified && !updated) {
    issues.push({
      code: "missing-frontmatter-verification",
      message: `${fileName}: operational rule pages require frontmatter.last_verified or frontmatter.updated`,
    });
  }
  if (lastVerified && !isIsoDate(lastVerified)) {
    issues.push({
      code: "frontmatter-last-verified-format",
      message: `${fileName}: frontmatter.last_verified must be YYYY-MM-DD`,
    });
  }
  if (updated && !isIsoDate(updated)) {
    issues.push({
      code: "frontmatter-updated-format",
      message: `${fileName}: frontmatter.updated must be YYYY-MM-DD`,
    });
  }

  const sections = parseSections(parsed.body);
  if (!Object.prototype.hasOwnProperty.call(sections, "Summary")) {
    issues.push({
      code: "missing-section",
      message: `${fileName}: missing required section "## Summary"`,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(sections, "Related")) {
    issues.push({
      code: "missing-section",
      message: `${fileName}: missing required section "## Related"`,
    });
  }

  const additionalSections = Object.keys(sections).filter((section) => !["Summary", "Related"].includes(section));
  if (additionalSections.length === 0) {
    issues.push({
      code: "missing-section",
      message: `${fileName}: operational rule pages must include at least one rule/details section besides Summary and Related`,
    });
  }

  if (mode === "full") {
    issues.push(...lintRelativeLinks(fileName, absolutePath, parsed.body));
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintProjectDecisionPage(fileName, absolutePath, mode) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(contents);
  if (!parsed) {
    return {
      file: fileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-frontmatter",
        message: `${fileName}: YAML frontmatter is missing or malformed`,
      }],
    };
  }

  const frontmatter = parsed.frontmatter;
  if (!normalize(frontmatter.title)) {
    issues.push({
      code: "missing-frontmatter-title",
      message: `${fileName}: frontmatter.title is required`,
    });
  }
  if (normalize(frontmatter.type) !== "special/project-decisions") {
    issues.push({
      code: "frontmatter-type-mismatch",
      message: `${fileName}: frontmatter.type must be "special/project-decisions"`,
    });
  }
  if (!normalize(frontmatter.project)) {
    issues.push({
      code: "missing-frontmatter-project",
      message: `${fileName}: frontmatter.project is required`,
    });
  }
  if (!isIsoDateTime(frontmatter.updated)) {
    issues.push({
      code: "frontmatter-updated-format",
      message: `${fileName}: frontmatter.updated must be an ISO datetime`,
    });
  }

  const bootPriority = Number(normalize(frontmatter.boot_priority));
  if (!Number.isInteger(bootPriority)) {
    issues.push({
      code: "frontmatter-boot-priority-format",
      message: `${fileName}: frontmatter.boot_priority must be an integer`,
    });
  }

  const sections = parseSections(parsed.body);
  for (const section of ["About", "Decisions"]) {
    if (!Object.prototype.hasOwnProperty.call(sections, section)) {
      issues.push({
        code: "missing-section",
        message: `${fileName}: missing required section "## ${section}"`,
      });
    }
  }

  if (mode === "full") {
    issues.push(...lintRelativeLinks(fileName, absolutePath, parsed.body));
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintReferenceDocPage(fileName, absolutePath) {
  return {
    file: fileName,
    path: absolutePath,
    ok: true,
    issues: [],
  };
}

function lintIndexFile(fileName, absolutePath, mode) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");

  if (!contents.startsWith("# Kuma Vault Index")) {
    issues.push({
      code: "index-heading",
      message: `${fileName}: must start with "# Kuma Vault Index"`,
    });
  }

  for (const section of ["## Domains", "## Projects", "## Memos", "## Learnings", "## Results", "## Inbox", "## Cross References"]) {
    if (!contents.includes(section)) {
      issues.push({
        code: "missing-section",
        message: `${fileName}: missing required section "${section}"`,
      });
    }
  }

  if (mode === "full") {
    issues.push(...lintRelativeLinks(fileName, absolutePath, contents));
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintLogFile(fileName, absolutePath) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");

  if (!contents.startsWith("# Kuma Vault Change Log")) {
    issues.push({
      code: "log-heading",
      message: `${fileName}: must start with "# Kuma Vault Change Log"`,
    });
  }

  if (!/^## \d{4}-\d{2}-\d{2}$/mu.test(contents)) {
    issues.push({
      code: "missing-log-date-section",
      message: `${fileName}: must include at least one date section heading`,
    });
  }

  if (!/^- (INIT|MIGRATE|UPDATE|INGEST|CREATE|ARCHIVE|SYNC_SKILLS): /mu.test(contents)) {
    issues.push({
      code: "missing-log-entry",
      message: `${fileName}: must include at least one change entry`,
    });
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintResultArchivePage(fileName, absolutePath) {
  return {
    file: fileName,
    path: absolutePath,
    ok: true,
    issues: [],
  };
}

function lintSchemaFile(fileName, absolutePath, mode) {
  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(contents);
  if (!parsed) {
    return {
      file: fileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-frontmatter",
        message: `${fileName}: YAML frontmatter is missing or malformed`,
      }],
    };
  }

  if (!normalize(parsed.frontmatter.title)) {
    issues.push({
      code: "missing-frontmatter-title",
      message: `${fileName}: frontmatter.title is required`,
    });
  }
  if (!contents.includes("# Kuma Vault Schema")) {
    issues.push({
      code: "schema-heading",
      message: `${fileName}: must declare "# Kuma Vault Schema"`,
    });
  }

  for (const section of ["## Summary", "## Directories", "## Special Files"]) {
    if (!contents.includes(section)) {
      issues.push({
        code: "missing-section",
        message: `${fileName}: missing required section "${section}"`,
      });
    }
  }

  if (mode === "full") {
    issues.push(...lintRelativeLinks(fileName, absolutePath, parsed.body));
  }

  return {
    file: fileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

function lintSingleFile({ vaultDir, fileName, mode, schemaSections }) {
  const normalizedFileName = fileName.replace(/\\/gu, "/");
  const baseFileName = basename(normalizedFileName);
  const spec = normalizedFileName === baseFileName ? SPECIAL_VAULT_FILE_SPECS[baseFileName] : null;
  const absolutePath = resolve(vaultDir, normalizedFileName);

  if (!existsSync(absolutePath)) {
    return {
      file: normalizedFileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-file",
        message: `${normalizedFileName}: file does not exist`,
      }],
    };
  }

  if (normalizedFileName === "index.md") {
    return lintIndexFile(normalizedFileName, absolutePath, mode);
  }

  if (normalizedFileName === "log.md") {
    return lintLogFile(normalizedFileName, absolutePath);
  }

  if (normalizedFileName === "schema.md") {
    return lintSchemaFile(normalizedFileName, absolutePath, mode);
  }

  if (isMemoPage(normalizedFileName)) {
    return lintMemoPage(normalizedFileName, absolutePath, mode);
  }

  if (isResultArchivePage(normalizedFileName)) {
    return lintResultArchivePage(normalizedFileName, absolutePath);
  }

  if (isNestedReferenceDocPage(normalizedFileName)) {
    return lintReferenceDocPage(normalizedFileName, absolutePath);
  }

  if (isOperationalRulePage(normalizedFileName)) {
    return lintOperationalRulePage(normalizedFileName, absolutePath, mode);
  }

  if (isProjectDecisionPage(normalizedFileName)) {
    return lintProjectDecisionPage(normalizedFileName, absolutePath, mode);
  }

  if (isTopLevelDomainPage(normalizedFileName)) {
    const parsed = parseFrontmatter(readFileSync(absolutePath, "utf8"));
    if (parsed && normalize(parsed.frontmatter.source).startsWith("skills/")) {
      return lintManagedSkillPage(normalizedFileName, absolutePath);
    }
  }

  if (!spec) {
    return lintGenericPage(normalizedFileName, absolutePath, mode);
  }

  const issues = [];
  const contents = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(contents);
  if (!parsed) {
    return {
      file: normalizedFileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-frontmatter",
        message: `${normalizedFileName}: YAML frontmatter is missing or malformed`,
      }],
    };
  }

  for (const [key, rule] of Object.entries(spec.frontmatter)) {
    const issue = validateFrontmatterValue(normalizedFileName, key, rule, parsed.frontmatter[key]);
    if (issue) {
      issues.push(issue);
    }
  }

  if (mode === "full") {
    const sections = parseSections(parsed.body);

    for (const section of spec.requiredSections) {
      if (!Object.prototype.hasOwnProperty.call(sections, section)) {
        issues.push({
          code: "missing-section",
          message: `${normalizedFileName}: missing required section "## ${section}"`,
        });
      }
    }

    issues.push(...lintSchemaRegistration(normalizedFileName, spec, schemaSections));
    issues.push(...lintStructuralRules(normalizedFileName, spec, sections));
    issues.push(...lintRelativeLinks(normalizedFileName, absolutePath, parsed.body));
  }

  return {
    file: normalizedFileName,
    path: absolutePath,
    ok: issues.length === 0,
    issues,
  };
}

export function lintVaultFiles({
  vaultDir,
  mode = "full",
  files,
  schemaPath,
} = {}) {
  const resolvedVaultDir = resolve(vaultDir ?? resolveVaultDir());
  const lintMode = mode === "fast" ? "fast" : "full";
  const targetFiles = normalizeRequestedFiles(files);
  const startedAt = performance.now();
  let schemaSections = {};
  let schemaResolvedPath = null;
  const filesResult = [];
  const globalIssues = [];

  if (lintMode === "full") {
    schemaResolvedPath = resolve(schemaPath ?? join(resolvedVaultDir, "schema.md"));
    if (!existsSync(schemaResolvedPath)) {
      globalIssues.push({
        file: "schema.md",
        code: "missing-schema",
        message: `schema.md is missing: ${schemaResolvedPath}`,
      });
    } else {
      const schemaContents = readFileSync(schemaResolvedPath, "utf8");
      schemaSections = extractSchemaSections(schemaContents);
      if (Object.keys(schemaSections).length === 0) {
        globalIssues.push({
          file: "schema.md",
          code: "schema-special-files-missing",
          message: "schema.md is missing the `## Special Files` section",
        });
      }
      globalIssues.push(...scanSpecialFileSetMismatch(schemaSections));
    }

    globalIssues.push(...scanCanonicalDrift(resolvedVaultDir));
  }

  for (const fileName of targetFiles) {
    filesResult.push(lintSingleFile({
      vaultDir: resolvedVaultDir,
      fileName,
      mode: lintMode,
      schemaSections,
    }));
  }

  const issues = [
    ...globalIssues,
    ...filesResult.flatMap((entry) => entry.issues.map((issue) => ({ file: entry.file, ...issue }))),
  ];
  const durationMs = Number((performance.now() - startedAt).toFixed(3));

  return {
    ok: issues.length === 0,
    mode: lintMode,
    vaultDir: resolvedVaultDir,
    schemaPath: schemaResolvedPath,
    files: filesResult,
    issues,
    issueCount: issues.length,
    fileCount: filesResult.length,
    durationMs,
  };
}

export function formatVaultLintReport(result) {
  const status = result.ok ? "VAULT_LINT_OK" : "VAULT_LINT_FAIL";
  const lines = [
    `${status} mode=${result.mode} files=${result.fileCount} duration_ms=${result.durationMs}`,
  ];

  for (const fileResult of result.files) {
    lines.push(`${fileResult.ok ? "OK" : "FAIL"} ${fileResult.file}`);
    for (const issue of fileResult.issues) {
      lines.push(`- ${issue.message}`);
    }
  }

  for (const issue of result.issues.filter((entry) => entry.file === "schema.md")) {
    lines.push(`- ${issue.message}`);
  }

  return `${lines.join("\n")}\n`;
}
