import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DECISIONS_FILE_NAME = "decisions.md";
const DECISION_ACTIONS = new Set(["approve", "reject", "hold", "priority", "preference"]);
const RESOLUTION_ACTION = "resolve";
const KST_TIME_ZONE = "Asia/Seoul";
const DEDUPE_WINDOW = 10;

const DEFAULT_FRONTMATTER = Object.freeze({
  title: "Decisions Ledger",
  type: "special/decisions",
  updated: "",
  entry_rule: "explicit-user-decision-only",
  source_of_truth: "user-direct",
  boot_priority: "3",
});

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function trimString(value) {
  return normalizeString(value).trim();
}

function isDecisionAction(value) {
  return DECISION_ACTIONS.has(trimString(value));
}

function formatParts(date, options) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...options,
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function formatLedgerHeadingTimestamp(date) {
  const parts = formatParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function formatIdTimestamp(date) {
  const parts = formatParts(date);
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function buildDecisionId(date, entry) {
  const hash = createHash("sha1")
    .update(`${entry.action}|${entry.originalText}|${entry.scope}`)
    .digest("hex")
    .slice(0, 6);
  return `${formatIdTimestamp(date)}-${hash}`;
}

function quoteOriginalText(value) {
  return JSON.stringify(normalizeString(value));
}

function unquoteOriginalText(value) {
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

function parseLedgerEntries(sectionText) {
  const text = trimString(sectionText);
  if (!text || /^\(.*\)$/su.test(text)) {
    return [];
  }

  const entries = [];
  const chunks = text.split(/\n(?=### )/u);
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const heading = trimString(lines.shift());
    if (!heading.startsWith("### ")) {
      continue;
    }

    const headingText = heading.slice(4).trim();
    const [timestamp = "", action = "", scope = ""] = headingText.split(" · ").map((part) => part.trim());
    const entry = {
      headingTimestamp: timestamp,
      action,
      scope,
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r/gu, "");
      const match = line.match(/^\s*-\s+([a-z_]+):\s*(.*)$/u);
      if (!match) {
        continue;
      }

      const [, key, value] = match;
      entry[key] = value;
    }

    entry.id = trimString(entry.id);
    entry.writer = trimString(entry.writer);
    entry.context_ref = normalizeString(entry.context_ref);
    entry.original_text = unquoteOriginalText(entry.original_text);
    entry.supersedes = trimString(entry.supersedes);
    entry.decision_id = trimString(entry.decision_id);
    entry.resolved_at = trimString(entry.resolved_at);
    entries.push(entry);
  }

  return entries;
}

function normalizeFrontmatter(frontmatter, updatedAt) {
  return {
    ...DEFAULT_FRONTMATTER,
    ...(frontmatter ?? {}),
    updated: updatedAt,
  };
}

function formatFrontmatter(frontmatter) {
  return `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n`;
}

function formatOpenDecisions(entries) {
  const open = deriveOpenDecisions(entries);
  if (open.length === 0) {
    return "(없음)";
  }

  return open
    .map((entry) => `- ${entry.id}: ${entry.action} · ${entry.scope} · ${quoteOriginalText(entry.original_text)}`)
    .join("\n");
}

function formatLedgerEntry(entry) {
  const lines = [
    `### ${entry.headingTimestamp} · ${entry.action} · ${entry.scope}`,
    "",
    `- id: ${entry.id}`,
    `- action: ${entry.action}`,
    `- scope: ${entry.scope}`,
    `- writer: ${entry.writer}`,
    `- original_text: ${quoteOriginalText(entry.original_text)}`,
  ];

  if (trimString(entry.context_ref)) {
    lines.push(`- context_ref: ${trimString(entry.context_ref)}`);
  }
  if (trimString(entry.supersedes)) {
    lines.push(`- supersedes: ${trimString(entry.supersedes)}`);
  }
  if (trimString(entry.decision_id)) {
    lines.push(`- decision_id: ${trimString(entry.decision_id)}`);
  }
  if (trimString(entry.resolved_at)) {
    lines.push(`- resolved_at: ${trimString(entry.resolved_at)}`);
  }

  return lines.join("\n");
}

function formatLedger(entries) {
  if (entries.length === 0) {
    return "(비어 있음 — 유저 명시 발화만 기록)";
  }

  return entries.map(formatLedgerEntry).join("\n\n");
}

function renderDecisionsFile(frontmatter, entries) {
  return `${formatFrontmatter(frontmatter)}\n## Open Decisions\n${formatOpenDecisions(entries)}\n\n## Ledger\n${formatLedger(entries)}\n`;
}

async function ensureDecisionsFile(vaultDir) {
  const root = resolve(vaultDir);
  await mkdir(root, { recursive: true });
  const filePath = join(root, DECISIONS_FILE_NAME);

  if (!existsSync(filePath)) {
    const updatedAt = new Date().toISOString();
    await writeFile(filePath, renderDecisionsFile(normalizeFrontmatter(null, updatedAt), []), "utf8");
  }

  return filePath;
}

async function readDecisionsDocument(vaultDir) {
  const filePath = await ensureDecisionsFile(vaultDir);
  const contents = await readFile(filePath, "utf8");
  const parsed = parseFrontmatter(contents);
  const sections = parsed ? parseSections(parsed.body) : {};
  return {
    filePath,
    frontmatter: parsed?.frontmatter ?? { ...DEFAULT_FRONTMATTER },
    entries: parseLedgerEntries(sections.Ledger),
  };
}

function deriveOpenDecisions(entries) {
  const resolvedIds = new Set();
  const supersededIds = new Set();
  const openEntries = [];

  for (const entry of entries) {
    if (entry.action === RESOLUTION_ACTION && trimString(entry.decision_id)) {
      resolvedIds.add(trimString(entry.decision_id));
      continue;
    }
    if (isDecisionAction(entry.action) && trimString(entry.supersedes)) {
      supersededIds.add(trimString(entry.supersedes));
    }
  }

  for (const entry of entries) {
    if (!isDecisionAction(entry.action)) {
      continue;
    }
    if (resolvedIds.has(entry.id) || supersededIds.has(entry.id)) {
      continue;
    }
    openEntries.push({
      ...entry,
      original_text: normalizeString(entry.original_text),
    });
  }

  return openEntries;
}

function recentDecisionEntries(entries) {
  return entries.filter((entry) => isDecisionAction(entry.action)).slice(-DEDUPE_WINDOW);
}

function normalizeDecisionInput(entry, now = new Date(), overrides = {}) {
  const action = trimString(overrides.action ?? entry?.action);
  const scope = trimString(overrides.scope ?? entry?.scope);
  const writer = trimString(overrides.writer ?? entry?.writer);
  const originalText = normalizeString(overrides.originalText ?? entry?.original_text ?? entry?.originalText);
  const contextRef = normalizeString(overrides.contextRef ?? entry?.context_ref ?? entry?.contextRef);
  const supersedes = trimString(overrides.supersedes ?? entry?.supersedes);
  const decisionId = trimString(overrides.decisionId ?? entry?.decision_id ?? entry?.decisionId);
  const resolvedAt = trimString(overrides.resolvedAt ?? entry?.resolved_at ?? entry?.resolvedAt);

  if (!action) {
    throw new Error("decision action is required");
  }
  if (!scope) {
    throw new Error("decision scope is required");
  }
  if (!writer) {
    throw new Error("decision writer is required");
  }
  if (!originalText) {
    throw new Error("decision originalText is required");
  }

  return {
    id: trimString(overrides.id ?? entry?.id) || buildDecisionId(now, { action, scope, originalText }),
    headingTimestamp: formatLedgerHeadingTimestamp(now),
    action,
    scope,
    writer,
    original_text: originalText,
    context_ref: contextRef,
    supersedes,
    decision_id: decisionId,
    resolved_at: resolvedAt,
  };
}

async function persistDocument(filePath, frontmatter, entries, updatedAt) {
  const nextFrontmatter = normalizeFrontmatter(frontmatter, updatedAt);
  await writeFile(filePath, renderDecisionsFile(nextFrontmatter, entries), "utf8");
}

export async function appendDecision({ vaultDir, entry }) {
  const { filePath, frontmatter, entries } = await readDecisionsDocument(vaultDir);
  const recentEntries = recentDecisionEntries(entries);
  const now = new Date(trimString(entry?.createdAt) || Date.now());
  const normalized = normalizeDecisionInput(entry, now);

  const duplicate = recentEntries.find((candidate) =>
    candidate.action === normalized.action &&
    normalizeString(candidate.original_text) === normalized.original_text,
  );
  if (duplicate) {
    return { skipped: "duplicate", entry: { ...duplicate } };
  }

  const nextEntries = [...entries, normalized];
  const updatedAt = trimString(entry?.createdAt) || now.toISOString();
  await persistDocument(filePath, frontmatter, nextEntries, updatedAt);
  return { skipped: null, entry: normalized };
}

export async function listOpenDecisions({ vaultDir }) {
  const { entries } = await readDecisionsDocument(vaultDir);
  return deriveOpenDecisions(entries);
}

export async function resolveDecision({ vaultDir, id, writer = "user-direct", contextRef = "", resolvedAt = "" }) {
  const { filePath, frontmatter, entries } = await readDecisionsDocument(vaultDir);
  const targetId = trimString(id);
  const target = deriveOpenDecisions(entries).find((entry) => entry.id === targetId);
  if (!target) {
    throw new Error(`open decision not found: ${targetId}`);
  }

  const resolvedTimestamp = trimString(resolvedAt) || new Date().toISOString();
  const now = new Date(resolvedTimestamp);
  const resolutionEntry = normalizeDecisionInput(target, now, {
    action: RESOLUTION_ACTION,
    writer,
    contextRef,
    decisionId: targetId,
    resolvedAt: resolvedTimestamp,
  });

  const nextEntries = [...entries, resolutionEntry];
  await persistDocument(filePath, frontmatter, nextEntries, resolvedTimestamp);
  return { entry: resolutionEntry };
}

export async function supersedeDecision({ vaultDir, oldId, newEntry }) {
  const targetId = trimString(oldId);
  const open = await listOpenDecisions({ vaultDir });
  const target = open.find((entry) => entry.id === targetId);
  if (!target) {
    throw new Error(`open decision not found: ${targetId}`);
  }

  return appendDecision({
    vaultDir,
    entry: {
      ...newEntry,
      scope: trimString(newEntry?.scope) || target.scope,
      supersedes: targetId,
    },
  });
}
