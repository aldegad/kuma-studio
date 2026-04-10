import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

export const DEFAULT_SPECIAL_VAULT_FILES = Object.freeze([
  "current-focus.md",
  "dispatch-log.md",
  "decisions.md",
  "thread-map.md",
]);

export const SPECIAL_VAULT_FILE_SPECS = Object.freeze({
  "current-focus.md": {
    frontmatter: {
      title: { type: "string", exact: "Current Focus" },
      type: { type: "string", exact: "special/current-focus" },
      updated: { type: "iso-datetime" },
      active_count: { type: "integer", min: 0 },
      source_of_truth: { type: "string", exact: "kuma-task-lifecycle" },
      boot_priority: { type: "integer", exact: 1 },
    },
    requiredSections: ["Summary", "Active Dispatches", "Blockers", "Last Completed"],
    schemaType: "special/current-focus",
    schemaWriter: "kuma-task lifecycle hook",
    structuralChecks: ["active-count"],
  },
  "dispatch-log.md": {
    frontmatter: {
      title: { type: "string", exact: "Dispatch Log" },
      type: { type: "string", exact: "special/dispatch-log" },
      updated: { type: "iso-datetime" },
      entry_format: { type: "string", exact: "append-only-ledger" },
      source_of_truth: { type: "string", exact: "kuma-task-lifecycle" },
      boot_priority: { type: "integer", exact: 2 },
    },
    requiredSections: ["Entries"],
    schemaType: "special/dispatch-log",
    schemaWriter: "kuma-task lifecycle hook",
    structuralChecks: ["ledger"],
  },
  "decisions.md": {
    frontmatter: {
      title: { type: "string", exact: "Decisions Ledger" },
      type: { type: "string", exact: "special/decisions" },
      updated: { type: "iso-datetime" },
      entry_rule: { type: "string", exact: "explicit-user-decision-only" },
      source_of_truth: { type: "string", exact: "user-direct" },
      boot_priority: { type: "integer", exact: 3 },
    },
    requiredSections: ["Open Decisions", "Ledger"],
    schemaType: "special/decisions",
    schemaWriter: "user-direct",
    structuralChecks: [],
  },
  "thread-map.md": {
    frontmatter: {
      title: { type: "string", exact: "Thread Map" },
      type: { type: "string", exact: "special/thread-map" },
      updated: { type: "iso-datetime" },
      entry_format: { type: "string", exact: "active-thread-ledger" },
      source_of_truth: { type: "string", exact: "kuma-task-lifecycle" },
      boot_priority: { type: "integer", exact: 4 },
    },
    requiredSections: ["Active Threads", "Ledger"],
    schemaType: "special/thread-map",
    schemaWriter: "kuma-task lifecycle hook",
    structuralChecks: ["ledger"],
  },
});

const PLACEHOLDER_PATTERN = /^\(.*\)$/su;
const LEDGER_LINE_PATTERN = /^- \d{4}-\d{2}-\d{2}T[^|]+\| .+/u;
const SECTION_HEADING_PATTERN = /^##\s+/u;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/gu;

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
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

function parseNestedEntries(sectionText, primaryKey) {
  const text = normalize(sectionText);
  if (!text || PLACEHOLDER_PATTERN.test(text)) {
    return [];
  }

  const entries = [];
  let current = null;
  const headPattern = new RegExp(`^- ${primaryKey}:\\s*(.*)$`, "u");

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r/gu, "");
    const headMatch = line.match(headPattern);
    if (headMatch) {
      if (current) {
        entries.push(current);
      }
      current = { [primaryKey]: headMatch[1].trim() };
      continue;
    }

    if (!current) {
      continue;
    }

    const childMatch = line.match(/^\s+- ([a-z_]+):\s*(.*)$/u);
    if (childMatch) {
      current[childMatch[1]] = childMatch[2].trim();
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
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
    const fileName = basename(item.trim());
    if (!SPECIAL_VAULT_FILE_SPECS[fileName]) {
      throw new Error(`Unsupported vault special file: ${item}`);
    }
    return fileName;
  }))];
}

function isIsoDateTime(value) {
  return Boolean(value) && /\d{4}-\d{2}-\d{2}T/u.test(value) && !Number.isNaN(Date.parse(value));
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

function extractSchemaSections(schemaContents) {
  const specialStart = schemaContents.indexOf("## Special Files (4종)");
  if (specialStart === -1) {
    return {};
  }

  const specialSlice = schemaContents.slice(specialStart);
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

function lintStructuralRules(fileName, spec, frontmatter, sections) {
  const issues = [];

  if (spec.structuralChecks.includes("active-count")) {
    const activeEntries = parseNestedEntries(sections["Active Dispatches"], "task_id");
    const declaredCount = Number(normalize(frontmatter.active_count));
    if (Number.isInteger(declaredCount) && declaredCount !== activeEntries.length) {
      issues.push({
        code: "active-count-mismatch",
        message: `${fileName}: active_count=${declaredCount} but Active Dispatches has ${activeEntries.length} entries`,
      });
    }
  }

  if (spec.structuralChecks.includes("ledger")) {
    const sectionName = fileName === "thread-map.md" ? "Ledger" : "Entries";
    const lines = parseLedgerLines(sections[sectionName]);
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

function lintSingleFile({ vaultDir, fileName, mode, schemaSections }) {
  const spec = SPECIAL_VAULT_FILE_SPECS[fileName];
  const absolutePath = resolve(vaultDir, fileName);
  const issues = [];

  if (!existsSync(absolutePath)) {
    return {
      file: fileName,
      path: absolutePath,
      ok: false,
      issues: [{
        code: "missing-file",
        message: `${fileName}: file does not exist`,
      }],
    };
  }

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

  for (const [key, rule] of Object.entries(spec.frontmatter)) {
    const issue = validateFrontmatterValue(fileName, key, rule, parsed.frontmatter[key]);
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
          message: `${fileName}: missing required section "## ${section}"`,
        });
      }
    }

    issues.push(...lintSchemaRegistration(fileName, spec, schemaSections));
    issues.push(...lintStructuralRules(fileName, spec, parsed.frontmatter, sections));
    issues.push(...lintRelativeLinks(fileName, absolutePath, parsed.body));
  }

  return {
    file: fileName,
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
  const resolvedVaultDir = resolve(vaultDir ?? join(process.env.HOME ?? ".", ".kuma", "vault"));
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
          message: "schema.md is missing the `## Special Files (4종)` section",
        });
      }
    }
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
