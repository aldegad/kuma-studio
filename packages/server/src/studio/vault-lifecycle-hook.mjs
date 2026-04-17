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

function ledgerLine(timestamp, fields) {
  const ordered = [];
  for (const [key, value] of Object.entries(fields)) {
    const normalized = normalize(value);
    if (!normalized) continue;
    ordered.push(`${key}=${normalized}`);
  }
  return `- ${timestamp} | ${ordered.join(" | ")}`;
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

export async function runVaultLifecycleHook({
  event,
  taskFile,
  vaultDir,
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

    writeDispatchLog({ vaultDir: resolvedVaultDir, task, event, blockerArg: blocker, noteArg: note, now, warnings });

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
