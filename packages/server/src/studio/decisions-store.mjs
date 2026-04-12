import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DECISIONS_FILE_NAME = "decisions.md";
const DECISION_ACTIONS = new Set(["approve", "reject", "hold", "priority", "preference"]);
const KST_TIME_ZONE = "Asia/Seoul";
const DEDUPE_WINDOW = 10;
const DECISION_LAYERS = new Set(["inbox", "ledger"]);
const INBOX_PROMOTION_SEPARATOR = ", ";

const DEFAULT_FRONTMATTER = Object.freeze({
  title: "Decisions Ledger",
  type: "special/decisions",
  updated: "",
  layers: "inbox,ledger",
  boot_priority: "3",
});

const DEFAULT_ABOUT_TEXT = `이 파일은 2-layer 로 동작한다.

- **Ledger (resolved)** — 유저가 확정한 결정의 기록. writer = \`user-direct\` 또는 Inbox 에서 \`user-confirmed promotion\` 을 거친 entry.
- **Inbox (raw triggers)** — 결정을 촉발한 원본 발화/계획 todo/감사 hit. writer = \`kuma-detect | lifecycle-emitter | noeuri-audit | user-direct (unresolved)\`. **verbatim-only** — AI 해석/요약 금지. 아직 결정된 것이 아님.

승격 절차: Inbox entry 를 검토 → 유저가 resolved 문장을 확정 → Ledger 에 새 entry append (\`promoted_from: <inbox-id>\` 필드). Inbox 는 삭제하지 않고 \`status: promoted\` 로 마킹.

Boot pack 로드는 \`Ledger open + latest resolved 10\` + \`Inbox unresolved\`.`;

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
  const aboutText = trimString(document.aboutText) || DEFAULT_ABOUT_TEXT;
  const openText = formatOpenDecisions(document.ledgerEntries);
  const ledgerText = formatLedgerEntries(document.ledgerEntries);
  const inboxText = formatInboxEntries(document.inboxEntries, document.inboxIntroText);

  return `${frontmatter}\n## About\n\n${aboutText}\n\n## Open Decisions\n\n${openText}\n\n## Ledger\n\n${ledgerText}\n\n## Inbox\n\n${inboxText}\n`;
}

async function ensureDecisionsFile(vaultDir) {
  const root = resolve(vaultDir);
  await mkdir(root, { recursive: true });
  const filePath = join(root, DECISIONS_FILE_NAME);

  if (!existsSync(filePath)) {
    const updatedAt = new Date().toISOString();
    await writeFile(
      filePath,
      renderDecisionsFile({
        frontmatter: normalizeFrontmatter(null, updatedAt),
        aboutText: DEFAULT_ABOUT_TEXT,
        ledgerEntries: [],
        inboxEntries: [],
        inboxIntroText: "verbatim raw capture. 아직 결정된 것이 아니며, Ledger 로 승격되기 전까지는 맥락/트리거 기록용.",
      }),
      "utf8",
    );
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
    frontmatter: normalizeFrontmatter(parsed?.frontmatter, trimString(parsed?.frontmatter?.updated)),
    aboutText: sections.About || DEFAULT_ABOUT_TEXT,
    ledgerEntries: parseLedgerEntries(sections.Ledger),
    inboxEntries: parseInboxEntries(sections.Inbox),
    inboxIntroText: splitSectionIntroAndBlocks(sections.Inbox).introText,
  };
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
    frontmatter: normalizeFrontmatter(document.frontmatter, updatedAt),
  };
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
  const targetLayer = normalizeLayer(layer);
  if (!targetLayer) {
    throw new Error("decision layer is required");
  }

  const document = await readDecisionsDocument(vaultDir);
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

  const document = await readDecisionsDocument(vaultDir);
  const inboxIndex = document.inboxEntries.findIndex((entry) => entry.id === targetInboxId);
  if (inboxIndex === -1) {
    throw new Error(`inbox decision not found: ${targetInboxId}`);
  }

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
  const document = await readDecisionsDocument(vaultDir);
  return {
    ledger: document.ledgerEntries.map(toPublicLedgerEntry),
    inbox: document.inboxEntries
      .filter((entry) => trimString(entry.status || "unresolved") === "unresolved")
      .map(toPublicInboxEntry),
  };
}

export async function loadDecisionBootPack({
  vaultDir,
  openLedgerLimit = 10,
  latestResolvedLimit = 10,
  unresolvedInboxLimit = 10,
} = {}) {
  const activeVaultDir = resolve(vaultDir ?? join(process.env.HOME ?? ".", ".kuma", "vault"));
  const filePath = join(activeVaultDir, DECISIONS_FILE_NAME);

  if (!existsSync(filePath)) {
    return {
      ledger_open: [],
      latest_resolved: [],
      inbox_unresolved: [],
    };
  }

  const document = await readDecisionsDocument(activeVaultDir);
  const ledgerEntries = document.ledgerEntries.map(toPublicLedgerEntry);
  const unresolvedInboxEntries = document.inboxEntries
    .filter((entry) => trimString(entry.status || "unresolved") === "unresolved")
    .map(toPublicInboxEntry);

  return {
    ledger_open: ledgerEntries.slice(-openLedgerLimit).reverse(),
    latest_resolved: ledgerEntries.slice(-latestResolvedLimit).reverse(),
    inbox_unresolved: unresolvedInboxEntries.slice(-unresolvedInboxLimit).reverse(),
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
