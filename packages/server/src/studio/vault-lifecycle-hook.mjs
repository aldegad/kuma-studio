import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { parseFrontmatterDocument } from "./vault-ingest.mjs";
import { lintVaultFiles } from "./vault-lint.mjs";
import { resolveVaultDir } from "./memo-store.mjs";

const LIFECYCLE_EVENTS = new Set([
  "dispatched",
  "worker-done",
  "qa-passed",
  "qa-rejected",
  "failed",
]);

let lifecycleQueue = Promise.resolve();

function enqueue(fn) {
  const next = lifecycleQueue.then(fn, fn);
  lifecycleQueue = next.catch(() => undefined);
  return next;
}

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarize(body) {
  const lines = String(body ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const summaryLine = lines.find((line) => !line.startsWith("#")) ?? "";
  return summaryLine.replace(/\s+/gu, " ").slice(0, 160);
}

export function parseTaskFileMetadata(taskFile) {
  const resolved = normalize(taskFile) ? resolve(taskFile) : "";
  if (!resolved || !existsSync(resolved)) {
    return null;
  }

  const content = readFileSync(resolved, "utf8");
  const lines = String(content).replace(/\r/gu, "").split("\n");
  if (lines[0] !== "---" || lines.findIndex((line, index) => index > 0 && line === "---") === -1) {
    return null;
  }

  const parsed = parseFrontmatterDocument(content);
  const fm = parsed.frontmatter ?? {};

  return {
    taskFile: resolved,
    id: normalize(fm.id),
    project: normalize(fm.project),
    initiator: normalize(fm.initiator),
    worker: normalize(fm.worker),
    qa: normalize(fm.qa),
    result: normalize(fm.result),
    signal: normalize(fm.signal),
    plan: normalize(fm.plan),
    thread_id: normalize(fm.thread_id),
    session_id: normalize(fm.session_id),
    channel_id: normalize(fm.channel_id),
    summary: summarize(parsed.body),
  };
}

function hasFrontmatterBlock(contents) {
  const lines = String(contents ?? "").replace(/\r/gu, "").split("\n");
  if (lines[0] !== "---") {
    return false;
  }
  return lines.findIndex((line, index) => index > 0 && line === "---") !== -1;
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

function parseNestedEntries(sectionText, primaryKey) {
  const text = normalize(sectionText);
  if (!text || /^\(.*\)$/u.test(text)) {
    return [];
  }

  const entries = [];
  let current = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r/gu, "");
    const headMatch = line.match(new RegExp(`^- ${primaryKey}:\\s*(.*)$`, "u"));
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

function renderNestedEntries(entries, primaryKey, keys, emptyPlaceholder = "(없음)") {
  if (!Array.isArray(entries) || entries.length === 0) {
    return emptyPlaceholder;
  }

  return entries.map((entry) => {
    const lines = [`- ${primaryKey}: ${normalize(entry[primaryKey])}`];
    for (const key of keys) {
      if (key === primaryKey) continue;
      const value = normalize(entry[key]);
      if (!value) continue;
      lines.push(`  - ${key}: ${value}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

function parseLedgerLines(sectionText) {
  const text = normalize(sectionText);
  if (!text || /^\(.*\)$/u.test(text)) {
    return [];
  }

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

function renderLedgerLines(lines, emptyPlaceholder) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return emptyPlaceholder;
  }
  return lines.join("\n");
}

function serializeFrontmatter(frontmatter) {
  return [
    "---",
    ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${String(value ?? "").trim()}`),
    "---",
  ].join("\n");
}

function renderMarkdown(frontmatter, sections) {
  return `${serializeFrontmatter(frontmatter)}\n\n${sections.map(([title, body]) => `## ${title}\n${body}`.trimEnd()).join("\n\n")}\n`;
}

function loadManagedFile(path, warnings) {
  if (!existsSync(path)) {
    warnings.push({ key: `${basename(path)}:missing`, message: `${path} missing; skipping lifecycle hook update` });
    return null;
  }

  const content = readFileSync(path, "utf8");
  if (!hasFrontmatterBlock(content)) {
    warnings.push({ key: `${basename(path)}:invalid-frontmatter`, message: `${path} has no YAML frontmatter; skipping lifecycle hook update` });
    return null;
  }

  const parsed = parseFrontmatterDocument(content);
  return {
    path,
    frontmatter: parsed.frontmatter,
    sections: parseSections(parsed.body),
  };
}

function upsertEntry(entries, primaryKey, value, patch) {
  const existing = entries.find((entry) => normalize(entry[primaryKey]) === value) ?? {};
  const filtered = entries.filter((entry) => normalize(entry[primaryKey]) !== value);
  return [{ ...existing, ...patch, [primaryKey]: value }, ...filtered];
}

function removeEntry(entries, primaryKey, value) {
  return entries.filter((entry) => normalize(entry[primaryKey]) !== value);
}

function ledgerLine(timestamp, fields) {
  const ordered = [];
  for (const [key, value] of Object.entries(fields)) {
    const normalized = normalize(value);
    if (!normalized) continue;
    ordered.push(`${key}=${normalized}`);
  }
  return `- ${timestamp} | ${ordered.join(" | ")}`;
}

function writeCurrentFocus({ vaultDir, task, event, summaryArg, blockerArg, noteArg, now, warnings }) {
  const path = join(vaultDir, "current-focus.md");
  const file = loadManagedFile(path, warnings);
  if (!file) return;

  let activeEntries = parseNestedEntries(file.sections["Active Dispatches"], "task_id");
  let blockers = parseNestedEntries(file.sections["Blockers"], "task_id");
  let lastCompleted = parseNestedEntries(file.sections["Last Completed"], "task_id");

  const basePatch = {
    project: task.project,
    initiator: task.initiator,
    worker: task.worker,
    qa: task.qa,
    result: task.result,
    signal: task.signal,
    thread_id: task.thread_id,
    session_id: task.session_id,
    updated_at: now,
  };

  switch (event) {
    case "dispatched":
      activeEntries = upsertEntry(activeEntries, "task_id", task.id, {
        ...basePatch,
        state: "dispatched",
        summary: normalize(summaryArg) || task.summary || "task dispatched",
      });
      blockers = removeEntry(blockers, "task_id", task.id);
      break;
    case "worker-done":
      activeEntries = upsertEntry(activeEntries, "task_id", task.id, {
        ...basePatch,
        state: "awaiting-qa",
        summary: normalize(summaryArg) || (
          task.qa === "worker-self-report"
            ? "worker result detected, awaiting final signal"
            : "worker result detected, awaiting QA"
        ),
      });
      blockers = removeEntry(blockers, "task_id", task.id);
      break;
    case "qa-rejected":
      activeEntries = upsertEntry(activeEntries, "task_id", task.id, {
        ...basePatch,
        state: "qa-rejected",
        summary: normalize(summaryArg) || "QA rejected",
      });
      blockers = upsertEntry(blockers, "task_id", task.id, {
        blocker: normalize(blockerArg) || normalize(noteArg) || "QA rejected",
        updated_at: now,
      });
      break;
    case "failed":
      activeEntries = upsertEntry(activeEntries, "task_id", task.id, {
        ...basePatch,
        state: "failed",
        summary: normalize(summaryArg) || normalize(blockerArg) || "worker failed",
      });
      blockers = upsertEntry(blockers, "task_id", task.id, {
        blocker: normalize(blockerArg) || normalize(noteArg) || "worker failed",
        updated_at: now,
      });
      break;
    case "qa-passed":
      activeEntries = removeEntry(activeEntries, "task_id", task.id);
      blockers = removeEntry(blockers, "task_id", task.id);
      lastCompleted = [{
        task_id: task.id,
        closed_at: now,
        note: normalize(noteArg) || (
          task.qa === "worker-self-report"
            ? "worker-self-report signal emitted"
            : "QA PASS"
        ),
      }];
      break;
    default:
      break;
  }

  const summaryLines = [`- active dispatches: ${activeEntries.length}`];
  if (activeEntries.length > 0) {
    summaryLines.push(`- top priority: ${normalize(activeEntries[0].project)} / ${normalize(activeEntries[0].task_id)}`);
  }
  summaryLines.push("- resume rule: current-focus -> dispatch-log -> decisions -> thread-map 순으로 이어 읽기");

  file.frontmatter.updated = now;
  file.frontmatter.active_count = String(activeEntries.length);

  writeFileSync(path, renderMarkdown(file.frontmatter, [
    ["Summary", summaryLines.join("\n")],
    ["Active Dispatches", renderNestedEntries(activeEntries, "task_id", [
      "project",
      "initiator",
      "worker",
      "qa",
      "state",
      "result",
      "signal",
      "thread_id",
      "session_id",
      "updated_at",
      "summary",
    ])],
    ["Blockers", renderNestedEntries(blockers, "task_id", [
      "blocker",
      "updated_at",
    ])],
    ["Last Completed", renderNestedEntries(lastCompleted, "task_id", [
      "closed_at",
      "note",
    ])],
  ]), "utf8");
}

function writeDispatchLog({ vaultDir, task, event, blockerArg, noteArg, now, warnings }) {
  const path = join(vaultDir, "dispatch-log.md");
  const file = loadManagedFile(path, warnings);
  if (!file) return;

  const lines = parseLedgerLines(file.sections["Entries"]);
  const baseFields = {
    project: task.project,
    task_id: task.id,
    worker: task.worker,
    qa: task.qa,
    result: task.result,
    signal: task.signal,
    thread_id: task.thread_id,
    session_id: task.session_id,
  };

  switch (event) {
    case "dispatched":
      lines.push(ledgerLine(now, { ...baseFields, state: "dispatched" }));
      break;
    case "worker-done":
      lines.push(ledgerLine(now, { ...baseFields, state: "worker-done" }));
      lines.push(ledgerLine(now, { ...baseFields, state: "awaiting-qa" }));
      break;
    case "qa-passed":
      lines.push(ledgerLine(now, { ...baseFields, state: "qa-passed", note: normalize(noteArg) }));
      lines.push(ledgerLine(now, { ...baseFields, state: "signal-emitted" }));
      break;
    case "qa-rejected":
      lines.push(ledgerLine(now, { ...baseFields, state: "qa-rejected", note: normalize(blockerArg) || normalize(noteArg) }));
      break;
    case "failed":
      lines.push(ledgerLine(now, { ...baseFields, state: "failed", note: normalize(blockerArg) || normalize(noteArg) }));
      break;
    default:
      break;
  }

  file.frontmatter.updated = now;
  writeFileSync(path, renderMarkdown(file.frontmatter, [
    ["Entries", renderLedgerLines(lines, "(비어 있음 — lifecycle hook 연결 전)")],
  ]), "utf8");
}

function writeThreadMap({ vaultDir, task, event, now, warnings }) {
  if (!task.thread_id) return;

  const path = join(vaultDir, "thread-map.md");
  const file = loadManagedFile(path, warnings);
  if (!file) return;

  let activeThreads = parseNestedEntries(file.sections["Active Threads"], "thread_id");
  const ledger = parseLedgerLines(file.sections["Ledger"]);

  const threadPatch = {
    channel_id: task.channel_id || task.thread_id,
    session_id: task.session_id,
    latest_task_id: task.id,
    worker: task.worker,
    qa: task.qa,
    latest_result: task.result,
    latest_signal: task.signal,
    updated_at: now,
  };

  const ledgerBase = {
    thread_id: task.thread_id,
    session_id: task.session_id,
    task_id: task.id,
    result: task.result,
    signal: task.signal,
  };

  const statusByEvent = {
    dispatched: "dispatched",
    "worker-done": "awaiting-qa",
    "qa-rejected": "qa-rejected",
    failed: "failed",
    "qa-passed": "closed",
  };

  const status = statusByEvent[event];
  if (!status) return;

  activeThreads = upsertEntry(activeThreads, "thread_id", task.thread_id, {
    ...threadPatch,
    status,
  });
  ledger.push(ledgerLine(now, { ...ledgerBase, status }));

  file.frontmatter.updated = now;
  writeFileSync(path, renderMarkdown(file.frontmatter, [
    ["Active Threads", renderNestedEntries(activeThreads, "thread_id", [
      "channel_id",
      "session_id",
      "latest_task_id",
      "worker",
      "qa",
      "latest_result",
      "latest_signal",
      "status",
      "updated_at",
    ])],
    ["Ledger", renderLedgerLines(ledger, "(비어 있음 — lifecycle hook + discord bridge 연결 전)")],
  ]), "utf8");
}

export async function runVaultLifecycleHook({
  event,
  taskFile,
  vaultDir,
  summary,
  blocker,
  note,
} = {}) {
  if (process.env.KUMA_DISABLE_VAULT_HOOK === "1") {
    return { warnings: [] };
  }
  if (!LIFECYCLE_EVENTS.has(event)) {
    return { warnings: [] };
  }

  const task = parseTaskFileMetadata(taskFile);
  if (!task) {
    return { warnings: [] };
  }

  const resolvedVaultDir = resolve(vaultDir ?? resolveVaultDir());

  return enqueue(async () => {
    const warnings = [];
    const now = new Date().toISOString();

    writeCurrentFocus({ vaultDir: resolvedVaultDir, task, event, summaryArg: summary, blockerArg: blocker, noteArg: note, now, warnings });
    writeDispatchLog({ vaultDir: resolvedVaultDir, task, event, blockerArg: blocker, noteArg: note, now, warnings });
    writeThreadMap({ vaultDir: resolvedVaultDir, task, event, now, warnings });

    try {
      const lintResult = lintVaultFiles({ vaultDir: resolvedVaultDir, mode: "fast" });
      if (!lintResult.ok) {
        for (const issue of lintResult.issues) {
          warnings.push({
            key: `fast-lint:${issue.file}:${issue.code}`,
            message: `fast lint failed for ${issue.file}: ${issue.message}`,
          });
        }
      }
    } catch (error) {
      warnings.push({
        key: "fast-lint:runtime-error",
        message: `fast lint runtime failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return { warnings };
  });
}
