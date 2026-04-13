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
const DECISION_LAYERS = new Set(["inbox", "ledger"]);
const INBOX_PROMOTION_SEPARATOR = ", ";
const DEFAULT_INBOX_INTRO_TEXT = "verbatim raw capture. 아직 결정된 것이 아니며, Ledger 로 승격되기 전까지는 맥락/트리거 기록용.";

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function trimString(value) {
  return normalizeString(value).trim();
}

function normalizeLayer(value) {
  const layer = trimString(value);
  return DECISION_LAYERS.has(layer) ? layer : "";
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
    .update(`${entry.layer}|${entry.action}|${entry.scope}|${entry.originalText}|${entry.resolvedText}`)
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
      title: `${target.projectName} Project Decisions Ledger`,
      type: "special/project-decisions",
      project: target.projectName,
      updated: updatedAt,
      layers: "inbox,ledger",
      boot_priority: "3",
    };
  }

  return {
    title: "Decisions Ledger",
    type: "special/decisions",
    updated: updatedAt,
    layers: "inbox,ledger",
    boot_priority: "3",
  };
}

function createDefaultAboutText(target) {
  if (target.kind === "project") {
    return `이 파일은 \`project:${target.projectName}\` scoped decision memory 이다.

- **Ledger (resolved)** — 이 프로젝트에 대해 유저가 확정한 결정의 기록. writer = \`user-direct\` 또는 Inbox 에서 \`user-confirmed promotion\` 을 거친 entry.
- **Inbox (raw triggers)** — 이 프로젝트 결정으로 분류된 원본 발화/계획 todo/감사 hit. writer = \`kuma-detect | lifecycle-emitter | noeuri-audit | user-direct (unresolved)\`. **verbatim-only** — AI 해석/요약 금지. 아직 결정된 것이 아님.

승격 절차: Inbox entry 를 검토 → 유저가 resolved 문장을 확정 → Ledger 에 새 entry append (\`promoted_from: <inbox-id>\` 필드). Inbox 는 삭제하지 않고 \`status: promoted\` 로 마킹.

Boot pack 로드는 global decisions 뒤에 현재 프로젝트의 \`Ledger open + latest resolved 10 + Inbox unresolved\` 를 추가 로드한다.`;
  }

  return `이 파일은 global/system decision memory 이다.

- **Ledger (resolved)** — 유저가 전역 원칙으로 확정한 결정의 기록. writer = \`user-direct\` 또는 Inbox 에서 \`user-confirmed promotion\` 을 거친 entry.
- **Inbox (raw triggers)** — 말투/보고체계/SSOT 같은 전역 결정을 촉발한 원본 발화/감사 hit. writer = \`kuma-detect | lifecycle-emitter | noeuri-audit | user-direct (unresolved)\`. **verbatim-only** — AI 해석/요약 금지. 아직 결정된 것이 아님.

승격 절차: Inbox entry 를 검토 → 유저가 resolved 문장을 확정 → Ledger 에 새 entry append (\`promoted_from: <inbox-id>\` 필드). Inbox 는 삭제하지 않고 \`status: promoted\` 로 마킹.

Boot pack 로드는 global \`Ledger open + latest resolved 10 + Inbox unresolved\` 를 먼저 싣고, 현재 프로젝트가 있으면 project-decisions 를 뒤에 추가 로드한다.`;
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

function splitSectionIntroAndBlocks(sectionText) {
  const text = trimString(sectionText);
  if (!text || /^\(.*\)$/su.test(text)) {
    return {
      introText: "",
      blocks: [],
      placeholder: text,
    };
  }

  const firstHeadingIndex = text.indexOf("### ");
  if (firstHeadingIndex === -1) {
    return {
      introText: text,
      blocks: [],
      placeholder: "",
    };
  }

  const introText = text.slice(0, firstHeadingIndex).replace(/\n+$/u, "").trim();
  const entriesText = text.slice(firstHeadingIndex).trim();
  return {
    introText,
    blocks: entriesText.split(/\n(?=### )/u),
    placeholder: "",
  };
}

function parseLedgerEntries(sectionText) {
  const { blocks } = splitSectionIntroAndBlocks(sectionText);
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
        layer: "ledger",
        headingTimestamp,
        id: trimString(fields.id),
        action: trimString(fields.action || action),
        scope: trimString(fields.scope || scope),
        writer: trimString(fields.writer),
        resolved_text: unquoteText(fields.resolved_text),
        promoted_from: trimString(fields.promoted_from),
        context_ref: normalizeString(fields.context_ref),
      };
    })
    .filter(Boolean);
}

function parsePromotedTargets(value) {
  const raw = trimString(value);
  if (!raw) {
    return [];
  }

  return raw
    .split(/\s*,\s*/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatPromotedTargets(values) {
  const targets = Array.isArray(values)
    ? values.map((value) => trimString(value)).filter(Boolean)
    : parsePromotedTargets(values);
  return targets.join(INBOX_PROMOTION_SEPARATOR);
}

function parseInboxEntries(sectionText) {
  const { blocks } = splitSectionIntroAndBlocks(sectionText);
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
      const [id = "", writer = ""] = headingText.split(" · ").map((part) => part.trim());
      const fields = parseMarkdownFields(lines);

      return {
        layer: "inbox",
        id: trimString(id || fields.id),
        writer: trimString(writer || fields.writer),
        action: trimString(fields.action),
        scope: trimString(fields.scope),
        original_text: unquoteText(fields.original_text),
        context_ref: normalizeString(fields.context_ref),
        status: trimString(fields.status) || "unresolved",
        promoted_to: parsePromotedTargets(fields.promoted_to),
        note: normalizeString(fields.note),
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

function formatOpenDecisions(ledgerEntries) {
  if (ledgerEntries.length === 0) {
    return "(없음)";
  }

  return ledgerEntries
    .map((entry) => `- ${entry.id}: ${entry.action} · ${entry.scope} · ${quoteText(entry.resolved_text)}`)
    .join("\n");
}

function formatLedgerEntries(entries) {
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

      if (trimString(entry.promoted_from)) {
        lines.push(`- promoted_from: ${trimString(entry.promoted_from)}`);
      }
      if (trimString(entry.context_ref)) {
        lines.push(`- context_ref: ${trimString(entry.context_ref)}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function formatInboxEntries(entries, introText = "") {
  const normalized = entries.map((entry) => ({
    ...entry,
    promoted_to: Array.isArray(entry.promoted_to) ? entry.promoted_to : parsePromotedTargets(entry.promoted_to),
  }));

  const renderedEntries = normalized.length === 0
    ? "(비어 있음)"
    : normalized
        .map((entry) => {
          const lines = [
            `### ${entry.id} · ${entry.writer}`,
            "",
            `- action: ${entry.action}`,
            `- scope: ${entry.scope}`,
            `- original_text: ${quoteText(entry.original_text)}`,
          ];

          if (trimString(entry.context_ref)) {
            lines.push(`- context_ref: ${trimString(entry.context_ref)}`);
          }
          lines.push(`- status: ${trimString(entry.status) || "unresolved"}`);
          if (entry.promoted_to.length > 0) {
            lines.push(`- promoted_to: ${formatPromotedTargets(entry.promoted_to)}`);
          }
          if (trimString(entry.note)) {
            lines.push(`- note: ${trimString(entry.note)}`);
          }

          return lines.join("\n");
        })
        .join("\n\n");

  const trimmedIntro = trimString(introText);
  if (!trimmedIntro) {
    return renderedEntries;
  }

  return `${trimmedIntro}\n\n${renderedEntries}`;
}

function renderDecisionsFile(document) {
  const frontmatter = formatFrontmatter(document.frontmatter);
  const aboutText = trimString(document.aboutText) || createDefaultAboutText(document.target);
  const openText = formatOpenDecisions(document.ledgerEntries);
  const ledgerText = formatLedgerEntries(document.ledgerEntries);
  const inboxText = formatInboxEntries(document.inboxEntries, document.inboxIntroText);

  return `${frontmatter}\n## About\n\n${aboutText}\n\n## Open Decisions\n\n${openText}\n\n## Ledger\n\n${ledgerText}\n\n## Inbox\n\n${inboxText}\n`;
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
    ledgerEntries: [],
    inboxEntries: [],
    inboxIntroText: DEFAULT_INBOX_INTRO_TEXT,
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
    ledgerEntries: parseLedgerEntries(sections.Ledger),
    inboxEntries: parseInboxEntries(sections.Inbox),
    inboxIntroText: splitSectionIntroAndBlocks(sections.Inbox).introText || DEFAULT_INBOX_INTRO_TEXT,
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

function recentEntriesForLayer(entries, layer) {
  return entries.slice(-DEDUPE_WINDOW).filter((entry) => entry.layer === layer);
}

function normalizeInboxEntry(entry, now = new Date()) {
  const action = trimString(entry?.action);
  const scope = trimString(entry?.scope);
  const writer = trimString(entry?.writer);
  const originalText = normalizeString(entry?.original_text ?? entry?.originalText);
  const contextRef = normalizeString(entry?.context_ref ?? entry?.contextRef);
  const status = trimString(entry?.status) || "unresolved";
  const note = normalizeString(entry?.note);
  const promotedTo = Array.isArray(entry?.promoted_to ?? entry?.promotedTo)
    ? (entry.promoted_to ?? entry.promotedTo)
    : parsePromotedTargets(entry?.promoted_to ?? entry?.promotedTo);

  if (!isDecisionAction(action)) {
    throw new Error("inbox decision action is required");
  }
  if (!scope) {
    throw new Error("inbox decision scope is required");
  }
  if (!writer) {
    throw new Error("inbox decision writer is required");
  }
  if (!originalText) {
    throw new Error("inbox decision originalText is required");
  }

  return {
    layer: "inbox",
    id: trimString(entry?.id) || buildDecisionId(now, { layer: "inbox", action, scope, originalText, resolvedText: "" }),
    writer,
    action,
    scope,
    original_text: originalText,
    context_ref: contextRef,
    status,
    promoted_to: promotedTo.map((value) => trimString(value)).filter(Boolean),
    note,
  };
}

function normalizeLedgerEntry(entry, now = new Date()) {
  const action = trimString(entry?.action);
  const scope = trimString(entry?.scope);
  const writer = trimString(entry?.writer);
  const resolvedText = normalizeString(entry?.resolved_text ?? entry?.resolvedText);
  const contextRef = normalizeString(entry?.context_ref ?? entry?.contextRef);
  const promotedFrom = trimString(entry?.promoted_from ?? entry?.promotedFrom);

  if (!isDecisionAction(action)) {
    throw new Error("ledger decision action is required");
  }
  if (!scope) {
    throw new Error("ledger decision scope is required");
  }
  if (!writer) {
    throw new Error("ledger decision writer is required");
  }
  if (!resolvedText) {
    throw new Error("ledger decision resolvedText is required");
  }

  return {
    layer: "ledger",
    id: trimString(entry?.id) || buildDecisionId(now, { layer: "ledger", action, scope, originalText: "", resolvedText }),
    headingTimestamp: trimString(entry?.headingTimestamp) || formatLedgerHeadingTimestamp(now),
    writer,
    action,
    scope,
    resolved_text: resolvedText,
    promoted_from: promotedFrom,
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

function toPublicLedgerEntry(entry) {
  return {
    id: entry.id,
    action: entry.action,
    scope: entry.scope,
    writer: entry.writer,
    resolved_text: normalizeString(entry.resolved_text),
    promoted_from: trimString(entry.promoted_from),
    context_ref: normalizeString(entry.context_ref),
    headingTimestamp: trimString(entry.headingTimestamp),
    layer: "ledger",
  };
}

function toPublicInboxEntry(entry) {
  return {
    id: entry.id,
    action: entry.action,
    scope: entry.scope,
    writer: entry.writer,
    original_text: normalizeString(entry.original_text),
    context_ref: normalizeString(entry.context_ref),
    status: trimString(entry.status) || "unresolved",
    promoted_to: Array.isArray(entry.promoted_to) ? [...entry.promoted_to] : parsePromotedTargets(entry.promoted_to),
    note: normalizeString(entry.note),
    layer: "inbox",
  };
}

export async function appendDecision({ vaultDir, layer, entry }) {
  const targetLayer = normalizeLayer(layer || entry?.layer);
  if (!targetLayer) {
    throw new Error("decision layer is required");
  }

  const target = resolveDecisionStoreTarget(vaultDir, entry?.scope);
  const document = await readDecisionsDocument(target);
  const createdAt = trimString(entry?.createdAt);
  const now = new Date(createdAt || Date.now());

  if (targetLayer === "inbox") {
    const normalized = normalizeInboxEntry(entry, now);
    const recentEntries = recentEntriesForLayer(document.inboxEntries, "inbox");
    const duplicate = recentEntries.find((candidate) =>
      candidate.action === normalized.action &&
      normalizeString(candidate.original_text) === normalized.original_text,
    );
    if (duplicate) {
      return { skipped: "duplicate", entry: toPublicInboxEntry(duplicate) };
    }

    const nextDocument = {
      ...document,
      inboxEntries: [...document.inboxEntries, normalized],
    };
    await persistDocument(document.filePath, nextDocument, createdAt || now.toISOString());
    return { skipped: null, entry: toPublicInboxEntry(normalized) };
  }

  const normalized = normalizeLedgerEntry(entry, now);
  const recentEntries = recentEntriesForLayer(document.ledgerEntries, "ledger");
  const duplicate = recentEntries.find((candidate) =>
    candidate.action === normalized.action &&
    normalizeString(candidate.resolved_text) === normalized.resolved_text,
  );
  if (duplicate) {
    return { skipped: "duplicate", entry: toPublicLedgerEntry(duplicate) };
  }

  const nextDocument = {
    ...document,
    ledgerEntries: [...document.ledgerEntries, normalized],
  };
  await persistDocument(document.filePath, nextDocument, createdAt || now.toISOString());
  return { skipped: null, entry: toPublicLedgerEntry(normalized) };
}

export async function promoteToLedger({ vaultDir, inboxId, resolvedText, writer, contextRef = "" }) {
  const targetInboxId = trimString(inboxId);
  const resolved_text = normalizeString(resolvedText);
  const promotionWriter = trimString(writer);

  if (!targetInboxId) {
    throw new Error("inboxId is required");
  }
  if (!resolved_text) {
    throw new Error("resolvedText is required");
  }
  if (!promotionWriter) {
    throw new Error("writer is required");
  }

  const documents = await readAllDecisionDocuments(vaultDir);
  const matches = documents
    .map((document) => ({ document, inboxIndex: document.inboxEntries.findIndex((entry) => entry.id === targetInboxId) }))
    .filter((match) => match.inboxIndex !== -1);

  if (matches.length === 0) {
    throw new Error(`inbox decision not found: ${targetInboxId}`);
  }
  if (matches.length > 1) {
    throw new Error(`inbox decision id is duplicated across stores: ${targetInboxId}`);
  }

  const [{ document, inboxIndex }] = matches;
  const inboxEntry = document.inboxEntries[inboxIndex];
  const now = new Date();
  const ledgerEntry = normalizeLedgerEntry(
    {
      action: inboxEntry.action,
      scope: inboxEntry.scope,
      writer: promotionWriter,
      resolvedText: resolved_text,
      promotedFrom: targetInboxId,
      contextRef: trimString(contextRef) || inboxEntry.context_ref,
    },
    now,
  );

  const currentTargets = Array.isArray(inboxEntry.promoted_to) ? inboxEntry.promoted_to : parsePromotedTargets(inboxEntry.promoted_to);
  const nextTargets = [...currentTargets, ledgerEntry.id];
  const nextInboxEntry = {
    ...inboxEntry,
    status: "promoted",
    promoted_to: nextTargets,
  };
  const nextInboxEntries = document.inboxEntries.slice();
  nextInboxEntries[inboxIndex] = nextInboxEntry;

  const nextDocument = {
    ...document,
    ledgerEntries: [...document.ledgerEntries, ledgerEntry],
    inboxEntries: nextInboxEntries,
  };
  await persistDocument(document.filePath, nextDocument, now.toISOString());

  return {
    ledgerId: ledgerEntry.id,
    inboxId: targetInboxId,
  };
}

export async function listOpenDecisions({ vaultDir }) {
  const documents = await readAllDecisionDocuments(vaultDir);
  return {
    ledger: documents
      .flatMap((document) => document.ledgerEntries.map(toPublicLedgerEntry))
      .sort((left, right) => right.id.localeCompare(left.id)),
    inbox: documents
      .flatMap((document) => document.inboxEntries
        .filter((entry) => trimString(entry.status || "unresolved") === "unresolved")
        .map(toPublicInboxEntry))
      .sort((left, right) => right.id.localeCompare(left.id)),
  };
}

function buildBootPackSection(target, document, { openLedgerLimit, latestResolvedLimit, unresolvedInboxLimit }) {
  const ledgerEntries = document ? document.ledgerEntries.map(toPublicLedgerEntry) : [];
  const unresolvedInboxEntries = document
    ? document.inboxEntries
      .filter((entry) => trimString(entry.status || "unresolved") === "unresolved")
      .map(toPublicInboxEntry)
    : [];

  return {
    source: target.sourceLabel,
    scope: target.scope,
    projectName: target.projectName,
    ledger_open: ledgerEntries.slice(-openLedgerLimit).reverse(),
    latest_resolved: ledgerEntries.slice(-latestResolvedLimit).reverse(),
    inbox_unresolved: unresolvedInboxEntries.slice(-unresolvedInboxLimit).reverse(),
  };
}

export async function loadDecisionBootPack({
  vaultDir,
  projectName = "",
  openLedgerLimit = 10,
  latestResolvedLimit = 10,
  unresolvedInboxLimit = 10,
} = {}) {
  const activeVaultDir = resolve(vaultDir ?? join(process.env.HOME ?? ".", ".kuma", "vault"));
  const limits = { openLedgerLimit, latestResolvedLimit, unresolvedInboxLimit };
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
    ledger_open: globalPack.ledger_open,
    latest_resolved: globalPack.latest_resolved,
    inbox_unresolved: globalPack.inbox_unresolved,
    global: globalPack,
    project: projectPack,
  };
}

export async function resolveDecision({ vaultDir, id, resolvedText, writer = "user-direct", contextRef = "" }) {
  return promoteToLedger({
    vaultDir,
    inboxId: id,
    resolvedText,
    writer,
    contextRef,
  });
}

export async function supersedeDecision() {
  throw new Error("supersedeDecision is not supported in the 2-layer decisions store");
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
      movedLedgerCount: 0,
      movedInboxCount: 0,
    };
  }

  const globalDocument = await readDecisionsDocument(globalTarget);
  const nextGlobalLedgerEntries = [];
  const nextGlobalInboxEntries = [];
  const projectGroups = new Map();

  function pushProjectEntry(layer, entry) {
    const target = resolveDecisionStoreTarget(activeVaultDir, entry.scope);
    const current = projectGroups.get(target.scope) ?? { target, ledgerEntries: [], inboxEntries: [] };
    if (layer === "ledger") {
      current.ledgerEntries.push(entry);
    } else {
      current.inboxEntries.push(entry);
    }
    projectGroups.set(target.scope, current);
  }

  for (const entry of globalDocument.ledgerEntries) {
    if (isProjectDecisionScope(entry.scope)) {
      pushProjectEntry("ledger", entry);
    } else {
      nextGlobalLedgerEntries.push(entry);
    }
  }

  for (const entry of globalDocument.inboxEntries) {
    if (isProjectDecisionScope(entry.scope)) {
      pushProjectEntry("inbox", entry);
    } else {
      nextGlobalInboxEntries.push(entry);
    }
  }

  if (projectGroups.size === 0) {
    return {
      movedProjectScopes: [],
      movedLedgerCount: 0,
      movedInboxCount: 0,
    };
  }

  const updatedAt = new Date().toISOString();
  for (const { target, ledgerEntries, inboxEntries } of projectGroups.values()) {
    const projectDocument = existsSync(target.filePath)
      ? await readDecisionsDocument(target)
      : createEmptyDocument(target, updatedAt);

    await persistDocument(target.filePath, {
      ...projectDocument,
      ledgerEntries: mergeEntriesById(projectDocument.ledgerEntries, ledgerEntries),
      inboxEntries: mergeEntriesById(projectDocument.inboxEntries, inboxEntries),
    }, updatedAt);
  }

  await persistDocument(globalTarget.filePath, {
    ...globalDocument,
    ledgerEntries: nextGlobalLedgerEntries,
    inboxEntries: nextGlobalInboxEntries,
  }, updatedAt);

  return {
    movedProjectScopes: [...projectGroups.keys()].sort(),
    movedLedgerCount: [...projectGroups.values()].reduce((sum, group) => sum + group.ledgerEntries.length, 0),
    movedInboxCount: [...projectGroups.values()].reduce((sum, group) => sum + group.inboxEntries.length, 0),
  };
}
