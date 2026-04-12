#!/bin/bash
# Usage: kuma-cmux-wait.sh <signal-name> <result-file> [--surface <surface-id>] [--timeout <seconds>]
# Waits for a cmux signal and prints the result file contents when available.
# When --surface is provided, timeout boundaries become liveness checkpoints:
# working surfaces reset the timeout, idle/dead surfaces fail immediately.
set -euo pipefail

SCRIPT_PATH="$(node -e 'const fs = require("node:fs"); const input = process.argv[1]; try { process.stdout.write(fs.realpathSync(input)); } catch { process.stdout.write(input); }' "$0")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

find_repo_root() {
  local dir="$SCRIPT_DIR"

  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && [ -f "$dir/packages/server/src/cli.mjs" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

REPO_ROOT="${KUMA_REPO_ROOT:-$(find_repo_root || pwd)}"
SOURCE_REPO_ROOT="${KUMA_SOURCE_REPO_ROOT:-$(find_repo_root || pwd)}"
KUMA_SURFACE_CLASSIFIER_CLI="${KUMA_SURFACE_CLASSIFIER_CLI:-$REPO_ROOT/packages/shared/surface-classifier-cli.mjs}"
AUTO_INGEST_ENABLED="${KUMA_AUTO_VAULT_INGEST:-1}"
AUTO_INGEST_TASK_DIR="${KUMA_TASK_DIR:-/tmp/kuma-tasks}"
AUTO_INGEST_STAMP_DIR="${KUMA_AUTO_INGEST_STAMP_DIR:-/tmp/kuma-vault-auto-ingest}"
KUMA_SURFACES_PATH="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
KUMA_CMUX_SEND_SCRIPT="${KUMA_CMUX_SEND_SCRIPT:-$HOME/.kuma/cmux/kuma-cmux-send.sh}"
AUTO_NOEURI_TRIGGER_ENABLED="${KUMA_AUTO_NOEURI_TRIGGER:-1}"
KUMA_RESULT_DIR_PATH="${KUMA_RESULT_DIR:-/tmp/kuma-results}"
KUMA_VAULT_DIR="${KUMA_VAULT_DIR:-$HOME/.kuma/vault}"
KUMA_USER_MEMO_DIR="${KUMA_USER_MEMO_DIR:-$HOME/.claude/projects}"
KUMA_DISABLE_VAULT_HOOK="${KUMA_DISABLE_VAULT_HOOK:-0}"
KUMA_VAULT_LOCK_PATH="${KUMA_VAULT_LOCK_PATH:-$KUMA_VAULT_DIR/.lock}"
KUMA_WAIT_POLL_INTERVAL="${KUMA_WAIT_POLL_INTERVAL:-5}"

VAULT_HOOK_WARNED_KEYS=$'\n'

RAW_ARGS=("$@")
SIGNAL=""

RESULT_FILE=""
SURFACE=""
TIMEOUT=180
TASK_METADATA_JSON_CACHE=""
WORKER_DONE_RECORDED=0
QA_REJECT_RECORDED=0

SIGNAL_DIR="${KUMA_SIGNAL_DIR:-/tmp/kuma-signals}"
AUTO_INGEST_STATUS=""
WAIT_REFERENCE_TIMESTAMP_MS="0"
LIVENESS_TIMEOUT_STATUS=""
LIVENESS_TIMEOUT_PREVIEW=""
LIVENESS_TIMEOUT_NORMALIZED_PREVIEW=""

signal_file_exists() {
  [ -f "$SIGNAL_DIR/$SIGNAL" ]
}

path_mtime_ms() {
  local path="${1:?path required}"

  node -e '
const fs = require("node:fs");
const path = process.argv[1];
if (!path || !fs.existsSync(path)) {
  process.exit(1);
}
process.stdout.write(`${Math.floor(fs.statSync(path).mtimeMs)}\n`);
' "$path"
}

resolve_wait_reference_timestamp_ms() {
  local task_json=""
  local task_file=""

  task_json="$(current_task_metadata_json)"
  task_file="$(json_field "$task_json" taskFile)"
  if [ -n "$task_file" ] && [ -f "$task_file" ]; then
    path_mtime_ms "$task_file"
    return 0
  fi

  printf '0\n'
}

initialize_signal_wait_reference() {
  WAIT_REFERENCE_TIMESTAMP_MS="$(resolve_wait_reference_timestamp_ms 2>/dev/null || printf '0\n')"
}

signal_file_is_fresh() {
  local signal_path="$SIGNAL_DIR/$SIGNAL"

  [ -f "$signal_path" ] || return 1

  case "${WAIT_REFERENCE_TIMESTAMP_MS:-0}" in
    ""|0)
      return 0
      ;;
  esac

  node -e '
const fs = require("node:fs");
const signalPath = process.argv[1];
const referenceTimestampMs = Number(process.argv[2] || 0);
if (!signalPath || !fs.existsSync(signalPath)) {
  process.exit(1);
}
const signalTimestampMs = Math.floor(fs.statSync(signalPath).mtimeMs);
process.exit(signalTimestampMs >= referenceTimestampMs ? 0 : 1);
' "$signal_path" "$WAIT_REFERENCE_TIMESTAMP_MS"
}

extract_auto_ingest_status() {
  local payload="${1:-}"

  printf '%s' "$payload" | node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(1);
const data = JSON.parse(raw);
if (typeof data.status === "string" && data.status.trim()) {
  process.stdout.write(data.status.trim());
}
' 2>/dev/null || true
}

warn_once() {
  local key="${1:?warning key required}"
  local message="${2:?warning message required}"

  case "$VAULT_HOOK_WARNED_KEYS" in
    *$'\n'"$key"$'\n'*)
      return 0
      ;;
  esac

  VAULT_HOOK_WARNED_KEYS="${VAULT_HOOK_WARNED_KEYS}${key}"$'\n'
  printf 'VAULT_HOOK_WARN: %s\n' "$message" >&2
}

parse_task_file_json() {
  local task_file="${1:?task file required}"

  node --input-type=module - "$SOURCE_REPO_ROOT" "$task_file" <<'NODE'
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , repoRoot, taskFile] = process.argv;
const vaultIngestModuleUrl = pathToFileURL(resolve(repoRoot, "packages/server/src/studio/vault-ingest.mjs")).href;
const { parseFrontmatterDocument } = await import(vaultIngestModuleUrl);

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

if (!existsSync(taskFile)) {
  process.exit(1);
}

const content = readFileSync(taskFile, "utf8");
const normalizedLines = String(content ?? "").replace(/\r/gu, "").split("\n");
if (normalizedLines[0] !== "---" || normalizedLines.findIndex((line, index) => index > 0 && line === "---") === -1) {
  process.exit(1);
}

const parsed = parseFrontmatterDocument(content);
const frontmatter = parsed.frontmatter;
process.stdout.write(JSON.stringify({
  taskFile: resolve(taskFile),
  id: normalize(frontmatter.id),
  project: normalize(frontmatter.project),
  initiator: normalize(frontmatter.initiator),
  worker: normalize(frontmatter.worker),
  qa: normalize(frontmatter.qa),
  result: normalize(frontmatter.result),
  signal: normalize(frontmatter.signal),
  plan: normalize(frontmatter.plan),
  thread_id: normalize(frontmatter.thread_id),
  session_id: normalize(frontmatter.session_id),
  channel_id: normalize(frontmatter.channel_id),
  summary: summarize(parsed.body),
}));
NODE
}

resolve_task_metadata_json() {
  node --input-type=module - "$SOURCE_REPO_ROOT" "$AUTO_INGEST_TASK_DIR" "$RESULT_FILE" "$SIGNAL" <<'NODE'
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , repoRoot, taskDir, rawResultPath, signal] = process.argv;
const vaultIngestModuleUrl = pathToFileURL(resolve(repoRoot, "packages/server/src/studio/vault-ingest.mjs")).href;
const { parseFrontmatterDocument } = await import(vaultIngestModuleUrl);

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

if (!existsSync(taskDir)) {
  process.exit(1);
}

const resultPath = normalize(rawResultPath) ? resolve(rawResultPath) : "";
const files = readdirSync(taskDir)
  .filter((entry) => entry.endsWith(".task.md"))
  .sort();

for (const entry of files) {
  const taskFile = join(taskDir, entry);
  const content = readFileSync(taskFile, "utf8");
  const normalizedLines = String(content ?? "").replace(/\r/gu, "").split("\n");
  if (normalizedLines[0] !== "---" || normalizedLines.findIndex((line, index) => index > 0 && line === "---") === -1) {
    continue;
  }

  const parsed = parseFrontmatterDocument(content);
  const frontmatter = parsed.frontmatter;
  const taskResult = normalize(frontmatter.result);
  const taskSignal = normalize(frontmatter.signal);
  const resultMatches = resultPath && taskResult && resolve(taskResult) === resultPath;
  const signalMatches = signal && taskSignal === signal;
  if (!resultMatches && !signalMatches) {
    continue;
  }

  process.stdout.write(JSON.stringify({
    taskFile: resolve(taskFile),
    id: normalize(frontmatter.id),
    project: normalize(frontmatter.project),
    initiator: normalize(frontmatter.initiator),
    worker: normalize(frontmatter.worker),
    qa: normalize(frontmatter.qa),
    result: taskResult,
    signal: taskSignal,
    plan: normalize(frontmatter.plan),
    thread_id: normalize(frontmatter.thread_id),
    session_id: normalize(frontmatter.session_id),
    channel_id: normalize(frontmatter.channel_id),
    summary: summarize(parsed.body),
  }));
  process.exit(0);
}

process.exit(1);
NODE
}

current_task_metadata_json() {
  if [ -n "$TASK_METADATA_JSON_CACHE" ]; then
    printf '%s' "$TASK_METADATA_JSON_CACHE"
    return 0
  fi

  TASK_METADATA_JSON_CACHE="$(resolve_task_metadata_json 2>/dev/null || true)"
  printf '%s' "$TASK_METADATA_JSON_CACHE"
}

resolve_noeuri_surface() {
  node --input-type=module - "$KUMA_SURFACES_PATH" <<'NODE'
import { existsSync, readFileSync } from "node:fs";

const [, , surfacesPath] = process.argv;
if (!existsSync(surfacesPath)) {
  process.exit(1);
}

const surfaces = JSON.parse(readFileSync(surfacesPath, "utf8"));
const surface = typeof surfaces?.system?.["🦌 노을이"] === "string"
  ? surfaces.system["🦌 노을이"].trim()
  : "";

if (!surface) {
  process.exit(1);
}

process.stdout.write(surface);
NODE
}

json_field() {
  local json="${1:-}"
  local field="${2:?field required}"

  printf '%s' "$json" | node -e '
const fs = require("node:fs");
const field = process.argv[process.argv.length - 1];
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(1);
let value = JSON.parse(raw);
for (const segment of field.split(".")) {
  if (!segment) continue;
  if (value == null || typeof value !== "object" || !(segment in value)) {
    process.exit(1);
  }
  value = value[segment];
}
if (typeof value === "string" && value.trim()) {
  process.stdout.write(value.trim());
}
' "$field" 2>/dev/null || true
}

emit_vault_hook_warnings() {
  local response_json="${1:-}"

  [ -n "$response_json" ] || return 0

  while IFS=$'\t' read -r key message; do
    [ -n "$key" ] || continue
    warn_once "$key" "$message"
  done < <(
    printf '%s' "$response_json" | node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
const data = JSON.parse(raw);
for (const warning of Array.isArray(data.warnings) ? data.warnings : []) {
  if (!warning || typeof warning !== "object") continue;
  const key = typeof warning.key === "string" ? warning.key.trim() : "";
  const message = typeof warning.message === "string" ? warning.message.trim() : "";
  if (!key || !message) continue;
  process.stdout.write(`${key}\t${message}\n`);
}
' 2>/dev/null
  )
}

run_vault_lifecycle_hook() {
  local event="${1:?hook event required}"
  local task_json="${2:-}"
  local summary="${3:-}"
  local blocker="${4:-}"
  local note="${5:-}"
  local response=""
  local lock_fd=""

  [ "$KUMA_DISABLE_VAULT_HOOK" = "1" ] && return 0
  [ -n "$task_json" ] || return 0

  mkdir -p "$KUMA_VAULT_DIR" "$(dirname "$KUMA_VAULT_LOCK_PATH")"

  if command -v flock >/dev/null 2>&1; then
    exec {lock_fd}> "$KUMA_VAULT_LOCK_PATH"
    flock "$lock_fd"
  fi

if ! response="$(
    node --input-type=module - "$SOURCE_REPO_ROOT" "$KUMA_VAULT_DIR" "$event" "$task_json" "$summary" "$blocker" "$note" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const [, , repoRoot, vaultDir, event, rawTaskJson, summaryArg, blockerArg, noteArg] = process.argv;
const warnings = [];
const now = new Date().toISOString();
const vaultIngestModuleUrl = pathToFileURL(join(repoRoot, "packages/server/src/studio/vault-ingest.mjs")).href;
const { parseFrontmatterDocument } = await import(vaultIngestModuleUrl);

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function addWarning(filePath, reason, message) {
  warnings.push({
    key: `${basename(filePath)}:${reason}`,
    message,
  });
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

function loadManagedFile(path) {
  if (!existsSync(path)) {
    addWarning(path, "missing", `${path} missing; skipping lifecycle hook update`);
    return null;
  }

  const content = readFileSync(path, "utf8");
  if (!hasFrontmatterBlock(content)) {
    addWarning(path, "invalid-frontmatter", `${path} has no YAML frontmatter; skipping lifecycle hook update`);
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

function writeCurrentFocus(task) {
  const path = join(vaultDir, "current-focus.md");
  const file = loadManagedFile(path);
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

function writeDispatchLog(task) {
  const path = join(vaultDir, "dispatch-log.md");
  const file = loadManagedFile(path);
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

function writeThreadMap(task) {
  if (!task.thread_id) {
    return;
  }

  const path = join(vaultDir, "thread-map.md");
  const file = loadManagedFile(path);
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

  switch (event) {
    case "dispatched":
      activeThreads = upsertEntry(activeThreads, "thread_id", task.thread_id, {
        ...threadPatch,
        status: "dispatched",
      });
      ledger.push(ledgerLine(now, {
        thread_id: task.thread_id,
        session_id: task.session_id,
        task_id: task.id,
        result: task.result,
        signal: task.signal,
        status: "dispatched",
      }));
      break;
    case "worker-done":
      activeThreads = upsertEntry(activeThreads, "thread_id", task.thread_id, {
        ...threadPatch,
        status: "awaiting-qa",
      });
      ledger.push(ledgerLine(now, {
        thread_id: task.thread_id,
        session_id: task.session_id,
        task_id: task.id,
        result: task.result,
        signal: task.signal,
        status: "awaiting-qa",
      }));
      break;
    case "qa-rejected":
      activeThreads = upsertEntry(activeThreads, "thread_id", task.thread_id, {
        ...threadPatch,
        status: "qa-rejected",
      });
      ledger.push(ledgerLine(now, {
        thread_id: task.thread_id,
        session_id: task.session_id,
        task_id: task.id,
        result: task.result,
        signal: task.signal,
        status: "qa-rejected",
      }));
      break;
    case "failed":
      activeThreads = upsertEntry(activeThreads, "thread_id", task.thread_id, {
        ...threadPatch,
        status: "failed",
      });
      ledger.push(ledgerLine(now, {
        thread_id: task.thread_id,
        session_id: task.session_id,
        task_id: task.id,
        result: task.result,
        signal: task.signal,
        status: "failed",
      }));
      break;
    case "qa-passed":
      activeThreads = upsertEntry(activeThreads, "thread_id", task.thread_id, {
        ...threadPatch,
        status: "closed",
      });
      ledger.push(ledgerLine(now, {
        thread_id: task.thread_id,
        session_id: task.session_id,
        task_id: task.id,
        result: task.result,
        signal: task.signal,
        status: "closed",
      }));
      break;
    default:
      break;
  }

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

const task = JSON.parse(rawTaskJson);
if (event === "dispatched" || event === "worker-done" || event === "qa-rejected" || event === "failed" || event === "qa-passed") {
  writeCurrentFocus(task);
  writeDispatchLog(task);
  writeThreadMap(task);
}

try {
  const lintModuleUrl = pathToFileURL(join(repoRoot, "packages/server/src/studio/vault-lint.mjs")).href;
  const { lintVaultFiles } = await import(lintModuleUrl);
  const lintResult = lintVaultFiles({
    vaultDir,
    mode: "fast",
  });

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

process.stdout.write(JSON.stringify({ warnings }));
NODE
  )"; then
    if [ -n "$lock_fd" ]; then
      flock -u "$lock_fd" || true
      exec {lock_fd}>&-
    fi
    printf 'VAULT_HOOK_FAILED: event=%s\n' "$event" >&2
    return 0
  fi

  if [ -n "$lock_fd" ]; then
    flock -u "$lock_fd" || true
    exec {lock_fd}>&-
  fi

  emit_vault_hook_warnings "$response"
}

dispatch_noeuri_trigger() {
  [ "$AUTO_NOEURI_TRIGGER_ENABLED" != "0" ] || return 0
  [ "$AUTO_INGEST_STATUS" = "ingested" ] || return 0

  local task_json task_file task_id plan_path noeuri_surface noeuri_signal prompt noeuri_skill_path protected_user_memo_dir

  task_json="$(resolve_task_metadata_json 2>/dev/null || true)"
  if [ -z "$task_json" ]; then
    printf 'NOEURI_TRIGGER_FAILED: missing-task-metadata (signal=%s result=%s)\n' "$SIGNAL" "$RESULT_FILE" >&2
    return 0
  fi

  task_file="$(json_field "$task_json" taskFile)"
  task_id="$(json_field "$task_json" id)"
  plan_path="$(json_field "$task_json" plan)"
  noeuri_surface="$(resolve_noeuri_surface 2>/dev/null || true)"
  if [ -z "$task_id" ] || [ -z "$noeuri_surface" ]; then
    printf 'NOEURI_TRIGGER_FAILED: missing-task-id-or-surface (task=%s surface=%s)\n' "$task_id" "$noeuri_surface" >&2
    return 0
  fi

  if [ ! -x "$KUMA_CMUX_SEND_SCRIPT" ]; then
    printf 'NOEURI_TRIGGER_FAILED: send-script-not-executable (%s)\n' "$KUMA_CMUX_SEND_SCRIPT" >&2
    return 0
  fi

  noeuri_signal="noeuri-auto-${task_id}-done"
  noeuri_skill_path="${REPO_ROOT}/skills/noeuri/SKILL.md"
  protected_user_memo_dir="${KUMA_USER_MEMO_DIR}"
  prompt="Read ${RESULT_FILE}. task: ${task_id}. plan: ${plan_path:-none}. task-file: ${task_file}. Follow ${noeuri_skill_path} audit protocol. Auto-trigger guard: treat ${protected_user_memo_dir} as protected user-memo read-only notebook. Never write, rewrite, move, rename, or delete anything under that directory, including MEMORY.md. Ignore stale migration briefs that suggest moving or deleting memory/ files; report them only. Limit edits to vault/plan/skill files outside user-memo. 완료 시 result 파일은 /tmp/kuma-results/noeuri-audit-${task_id}.result.md, signal 은 /tmp/kuma-signals/${noeuri_signal}."

  if ! "$KUMA_CMUX_SEND_SCRIPT" "$noeuri_surface" "$prompt" > /dev/null 2>&1; then
    printf 'NOEURI_TRIGGER_FAILED: dispatch-error (surface=%s task=%s)\n' "$noeuri_surface" "$task_id" >&2
    return 0
  fi

  printf 'NOEURI_TRIGGER: surface=%s task=%s plan=%s signal=%s\n' "$noeuri_surface" "$task_id" "${plan_path:-none}" "$noeuri_signal" >&2
}

resolve_noeuri_audit_result_path() {
  local signal_name="${1:-}"
  local task_id=""

  case "$signal_name" in
    noeuri-auto-*-done)
      task_id="${signal_name#noeuri-auto-}"
      task_id="${task_id%-done}"
      ;;
    *)
      return 1
      ;;
  esac

  [ -n "$task_id" ] || return 1
  printf '%s/noeuri-audit-%s.result.md\n' "$KUMA_RESULT_DIR_PATH" "$task_id"
}

emit_noeuri_audit_report() {
  local audit_result_path=""

  audit_result_path="$(resolve_noeuri_audit_result_path "$SIGNAL" 2>/dev/null || true)"
  [ -n "$audit_result_path" ] || return 0
  [ -f "$audit_result_path" ] || return 0

  printf 'NOEURI_AUDIT_REPORT: file=%s\n' "$audit_result_path" >&2
  sed 's/^/NOEURI_AUDIT_REPORT: /' "$audit_result_path" >&2
}

task_completion_note() {
  local task_json="${1:-}"
  local qa_value=""

  if [ -z "$task_json" ]; then
    printf 'QA PASS'
    return 0
  fi

  qa_value="$(json_field "$task_json" qa)"
  if [ "$qa_value" = "worker-self-report" ]; then
    printf 'worker-self-report signal emitted'
    return 0
  fi

  printf 'QA PASS'
}

record_worker_done_transition_if_needed() {
  local task_json=""
  local summary=""

  [ "$WORKER_DONE_RECORDED" = "0" ] || return 0
  [ -n "$RESULT_FILE" ] || return 0
  [ -f "$RESULT_FILE" ] || return 0

  task_json="$(current_task_metadata_json)"
  [ -n "$task_json" ] || return 0

  if [ "$(json_field "$task_json" qa)" = "worker-self-report" ]; then
    summary="worker result detected, awaiting final signal"
  else
    summary="worker result detected, awaiting QA"
  fi

  run_vault_lifecycle_hook "worker-done" "$task_json" "$summary" "" ""
  WORKER_DONE_RECORDED=1
}

result_contains_qa_reject() {
  [ -n "$RESULT_FILE" ] || return 1
  [ -f "$RESULT_FILE" ] || return 1
  grep -Eq 'QA REJECT|❌ QA REJECT' "$RESULT_FILE"
}

extract_qa_reject_reason() {
  [ -n "$RESULT_FILE" ] || return 1
  [ -f "$RESULT_FILE" ] || return 1

  grep -E 'QA REJECT|❌ QA REJECT' "$RESULT_FILE" \
    | head -n 1 \
    | sed -E 's/^.*QA REJECT:?[[:space:]]*//; s/^❌[[:space:]]*//' \
    | sed 's/[[:space:]]\+$//'
}

record_qa_reject_transition_if_needed() {
  local task_json=""
  local blocker=""

  [ "$QA_REJECT_RECORDED" = "0" ] || return 0
  result_contains_qa_reject || return 0

  record_worker_done_transition_if_needed
  task_json="$(current_task_metadata_json)"
  [ -n "$task_json" ] || return 0

  blocker="$(extract_qa_reject_reason 2>/dev/null || true)"
  blocker="${blocker:-QA rejected}"

  run_vault_lifecycle_hook "qa-rejected" "$task_json" "QA rejected" "$blocker" "$blocker"
  QA_REJECT_RECORDED=1
}

observe_result_state() {
  record_worker_done_transition_if_needed
  record_qa_reject_transition_if_needed
}

auto_ingest_result() {
  AUTO_INGEST_STATUS=""
  [ "$AUTO_INGEST_ENABLED" != "0" ] || return 0
  [ -n "$RESULT_FILE" ] || return 0
  [ -f "$RESULT_FILE" ] || return 0

  local cmd=(
    npm run --silent --prefix "$REPO_ROOT" kuma-studio -- vault-auto-ingest "$RESULT_FILE"
    --signal "$SIGNAL"
    --task-dir "$AUTO_INGEST_TASK_DIR"
    --stamp-dir "$AUTO_INGEST_STAMP_DIR"
  )
  local output=""

  if [ -n "${KUMA_VAULT_DIR:-}" ]; then
    cmd+=(--vault-dir "$KUMA_VAULT_DIR")
  fi

  if [ -n "${KUMA_WIKI_DIR:-}" ]; then
    cmd+=(--wiki-dir "$KUMA_WIKI_DIR")
  fi

  if ! output="$("${cmd[@]}" 2>&1)"; then
    printf 'AUTO_INGEST_FAILED: %s\n' "$output" >&2
    return 1
  fi

  AUTO_INGEST_STATUS="$(extract_auto_ingest_status "$output")"

  if [ -n "$output" ]; then
    printf 'AUTO_INGEST: %s\n' "$output" >&2
  fi
}

print_result() {
  echo "SIGNAL_RECEIVED: $SIGNAL"
  if [ -n "$RESULT_FILE" ] && [ -f "$RESULT_FILE" ]; then
    echo "RESULT_FILE: $RESULT_FILE"
    cat "$RESULT_FILE"
  fi
  echo "DISCORD_REPORT_NEEDED"
}

completion_handler_refresh_state() {
  observe_result_state
}

completion_handler_finish_success() {
  local task_json=""
  local completion_note=""

  completion_handler_refresh_state
  task_json="$(current_task_metadata_json)"
  completion_note="$(task_completion_note "$task_json")"
  run_vault_lifecycle_hook "qa-passed" "$task_json" "" "" "$completion_note"

  auto_ingest_result || true

  dispatch_noeuri_trigger
  emit_noeuri_audit_report
  print_result
  exit 0
}

resolve_workspace() {
  local surface="$1"

  cmux tree 2>&1 | awk -v target="$surface" '
    {
      if (match($0, /workspace:[0-9]+/)) {
        current_ws = substr($0, RSTART, RLENGTH)
      }
      if (index($0, target) > 0) {
        print current_ws
        exit
      }
    }
  '
}

read_surface_snapshot() {
  local surface="$1"
  local workspace=""
  local read_args=()

  workspace="$(resolve_workspace "$surface")"
  if [ -n "$workspace" ]; then
    read_args+=(--workspace "$workspace")
  fi
  read_args+=(--surface "$surface" --lines 30)

  cmux read-screen "${read_args[@]}"
}

classify_surface_snapshot_json() {
  local output="${1-}"
  [ -f "$KUMA_SURFACE_CLASSIFIER_CLI" ] || {
    printf 'surface classifier bridge not found: %s\n' "$KUMA_SURFACE_CLASSIFIER_CLI" >&2
    exit 1
  }
  printf '%s' "$output" | node "$KUMA_SURFACE_CLASSIFIER_CLI"
}

surface_status_json() {
  local surface="$1"
  local output=""

  output="$(read_surface_snapshot "$surface" 2>&1 || true)"
  classify_surface_snapshot_json "$output"
}

compact_preview() {
  printf '%s' "${1:-}" \
    | tr '\r\n' '  ' \
    | sed 's/[[:space:]]\+/ /g' \
    | sed 's/^ //; s/ $//'
}

write_worker_down_error() {
  local preview="${1:-}"
  local normalized_preview=""

  normalized_preview="$(compact_preview "$preview")"
  [ -n "$RESULT_FILE" ] || return 0
  mkdir -p "$(dirname "$RESULT_FILE")"
  cat > "$RESULT_FILE" <<EOF
# ERROR: Worker Down
surface: $SURFACE
signal: $SIGNAL
preview: ${normalized_preview:-n/a}
워커가 응답 없이 종료되었거나 화면을 읽을 수 없음. 재스폰 필요.
EOF
}

write_worker_idle_error() {
  local preview="${1:-}"
  local normalized_preview=""

  normalized_preview="$(compact_preview "$preview")"
  [ -n "$RESULT_FILE" ] || return 0
  mkdir -p "$(dirname "$RESULT_FILE")"
  cat > "$RESULT_FILE" <<EOF
# ERROR: Worker Idle Without Signal
surface: $SURFACE
signal: $SIGNAL
preview: ${normalized_preview:-n/a}
워커가 idle 상태인데 완료 signal 이 없음. 재실행 또는 상태 확인 필요.
EOF
}

liveness_receiver_wait_once() {
  local timeout="$1"
  local observer_callback="${2:-}"
  local elapsed=0
  local interval="${KUMA_WAIT_POLL_INTERVAL:-5}"

  if [ -n "$observer_callback" ]; then
    "$observer_callback"
  fi

  # Exact signal-file polling is the canonical receiver path. We ignore stale
  # files that predate the current dispatch/task metadata and never rely on
  # cmux wait-for here because native wait can false-positive on similar names.
  if signal_file_is_fresh; then
    return 0
  fi

  while [ "$elapsed" -lt "$timeout" ]; do
    local remaining=$((timeout - elapsed))
    local wait_time=$((interval < remaining ? interval : remaining))

    if [ "$wait_time" -gt 0 ]; then
      sleep "$wait_time"
    fi

    if signal_file_is_fresh; then
      return 0
    fi

    if [ -n "$observer_callback" ]; then
      "$observer_callback"
    fi
    elapsed=$((elapsed + wait_time))
  done

  return 1
}

liveness_receiver_probe_timeout() {
  local status_json=""
  local status=""
  local preview=""
  local normalized_preview=""

  if signal_file_is_fresh; then
    return 0
  fi

  status_json="$(surface_status_json "$SURFACE")"
  status="$(json_field "$status_json" status)"
  preview="$(json_field "$status_json" preview)"
  normalized_preview="$(compact_preview "$preview")"

  if signal_file_is_fresh; then
    return 0
  fi

  LIVENESS_TIMEOUT_STATUS="$status"
  LIVENESS_TIMEOUT_PREVIEW="$preview"
  LIVENESS_TIMEOUT_NORMALIZED_PREVIEW="$normalized_preview"

  case "$status" in
    working)
      return 3
      ;;
    idle)
      return 2
      ;;
    *)
      return 1
      ;;
  esac
}

completion_handler_handle_timeout() {
  local timeout_rc="${1:?timeout result required}"
  local preview="${LIVENESS_TIMEOUT_PREVIEW:-}"
  local normalized_preview="${LIVENESS_TIMEOUT_NORMALIZED_PREVIEW:-n/a}"
  local task_json=""

  completion_handler_refresh_state

  case "$timeout_rc" in
    3)
      printf 'SIGNAL_TIMEOUT_CONTINUE: signal=%s surface=%s timeout=%ss status=%s preview=%s\n' \
        "$SIGNAL" \
        "$SURFACE" \
        "$TIMEOUT" \
        "${LIVENESS_TIMEOUT_STATUS:-working}" \
        "${normalized_preview:-n/a}" >&2
      return 3
      ;;
    2)
      task_json="$(current_task_metadata_json)"
      write_worker_idle_error "$preview"
      run_vault_lifecycle_hook "failed" "$task_json" "worker idle without signal" "worker idle without signal: ${normalized_preview:-n/a}" "worker idle without signal"
      printf 'WORKER_IDLE_NO_SIGNAL: signal=%s surface=%s timeout=%ss preview=%s\n' \
        "$SIGNAL" \
        "$SURFACE" \
        "$TIMEOUT" \
        "${normalized_preview:-n/a}" >&2
      return 2
      ;;
    *)
      task_json="$(current_task_metadata_json)"
      write_worker_down_error "$preview"
      run_vault_lifecycle_hook "failed" "$task_json" "worker down" "worker down: ${normalized_preview:-n/a}" "worker down"
      printf 'WORKER_DOWN: signal=%s surface=%s timeout=%ss preview=%s\n' \
        "$SIGNAL" \
        "$SURFACE" \
        "$TIMEOUT" \
        "${normalized_preview:-n/a}" >&2
      return 1
      ;;
  esac
}

run_vault_hook_cli() {
  local hook_event="${1:?hook event required}"
  shift

  local hook_task_file=""
  local hook_summary=""
  local hook_blocker=""
  local hook_note=""
  local hook_task_json=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --task-file)
        hook_task_file="${2:?task file required}"
        shift 2
        ;;
      --summary)
        hook_summary="${2:?summary required}"
        shift 2
        ;;
      --blocker)
        hook_blocker="${2:?blocker required}"
        shift 2
        ;;
      --note)
        hook_note="${2:?note required}"
        shift 2
        ;;
      *)
        printf 'Unknown vault hook argument: %s\n' "$1" >&2
        exit 1
        ;;
    esac
  done

  [ -n "$hook_task_file" ] || {
    printf 'vault hook requires --task-file\n' >&2
    exit 1
  }

  hook_task_json="$(parse_task_file_json "$hook_task_file" 2>/dev/null || true)"
  run_vault_lifecycle_hook "$hook_event" "$hook_task_json" "$hook_summary" "$hook_blocker" "$hook_note"
}

if [ "${RAW_ARGS[0]:-}" = "--vault-hook" ]; then
  [ "${#RAW_ARGS[@]}" -ge 2 ] || {
    printf 'Usage: kuma-cmux-wait.sh --vault-hook <event> --task-file <path> [--summary <text>] [--blocker <text>] [--note <text>]\n' >&2
    exit 1
  }

  run_vault_hook_cli "${RAW_ARGS[1]}" "${RAW_ARGS[@]:2}"
  exit 0
fi

set -- "${RAW_ARGS[@]}"

SIGNAL="${1:?signal name required}"
shift

if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  if [[ "$1" =~ ^[0-9]+$ ]]; then
    printf 'ERROR: bare numeric positional argument %s looks like a timeout. Use --timeout %s explicitly.\n' "$1" "$1" >&2
    exit 1
  fi
  RESULT_FILE="$1"
  shift
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --surface)
      SURFACE="${2:?surface id required}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="${2:?timeout seconds required}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

initialize_signal_wait_reference

if [ -z "$SURFACE" ]; then
  if liveness_receiver_wait_once "$TIMEOUT" completion_handler_refresh_state; then
    completion_handler_finish_success
  fi

  echo "SIGNAL_TIMEOUT: $SIGNAL (timeout=${TIMEOUT}s)" >&2
  exit 1
fi

while true; do
  if liveness_receiver_wait_once "$TIMEOUT" completion_handler_refresh_state; then
    completion_handler_finish_success
  fi

  set +e
  liveness_receiver_probe_timeout
  rc=$?
  set -e

  case "$rc" in
    0)
      completion_handler_finish_success
      ;;
    3|2|1)
      completion_handler_handle_timeout "$rc"
      case "$rc" in
        3)
          continue
          ;;
        *)
          exit "$rc"
          ;;
      esac
      ;;
    *)
      exit "$rc"
      ;;
  esac
done
