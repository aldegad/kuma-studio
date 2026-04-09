#!/bin/bash
set -euo pipefail

KUMA_HOME_DIR="${KUMA_HOME_DIR:-$HOME/.kuma}"
KUMA_CMUX_DIR="${KUMA_CMUX_DIR:-$KUMA_HOME_DIR/cmux}"
KUMA_TEAM_JSON_PATH="${KUMA_TEAM_JSON_PATH:-$KUMA_HOME_DIR/team.json}"
KUMA_PROJECTS_PATH="${KUMA_PROJECTS_PATH:-$KUMA_HOME_DIR/projects.json}"
KUMA_SURFACES_PATH="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
KUMA_TASK_DIR="${KUMA_TASK_DIR:-/tmp/kuma-tasks}"
KUMA_RESULT_DIR="${KUMA_RESULT_DIR:-/tmp/kuma-results}"
KUMA_DEFAULT_PROJECT="${KUMA_DEFAULT_PROJECT:-kuma-studio}"
KUMA_DEFAULT_QA_MEMBER="${KUMA_DEFAULT_QA_MEMBER:-밤토리}"
KUMA_WAIT_POLL_INTERVAL="${KUMA_WAIT_POLL_INTERVAL:-5}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_file() {
  [ -f "$1" ] || die "required file not found: $1"
}

ensure_runtime_requirements() {
  require_cmd node
  require_cmd cmux
  require_file "$KUMA_TEAM_JSON_PATH"
  require_file "$KUMA_SURFACES_PATH"
}

normalize_surface() {
  local raw="${1:-}"
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf 'surface:%s\n' "$raw"
    return
  fi
  printf '%s\n' "$raw"
}

resolve_initiator_surface() {
  if [ -n "${KUMA_INITIATOR_SURFACE:-}" ]; then
    normalize_surface "$KUMA_INITIATOR_SURFACE"
    return
  fi

  if [ -n "${CMUX_SURFACE_ID:-}" ]; then
    normalize_surface "$CMUX_SURFACE_ID"
    return
  fi

  printf 'surface:1\n'
}

ensure_json_object_file() {
  local path="${1:?json path required}"
  if [ ! -f "$path" ]; then
    mkdir -p "$(dirname "$path")"
    printf '{}\n' > "$path"
  fi
}

ensure_project_registry() {
  ensure_json_object_file "$KUMA_PROJECTS_PATH"
}

ensure_surface_registry() {
  ensure_json_object_file "$KUMA_SURFACES_PATH"
}

resolve_project_dir() {
  local project="${1:?project required}"

  node --input-type=module - "$KUMA_PROJECTS_PATH" "$project" <<'NODE'
import { existsSync, readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const [, , projectsPath, project] = process.argv;
if (!existsSync(projectsPath)) {
  process.exit(1);
}

const projects = JSON.parse(readFileSync(projectsPath, "utf8"));
const raw = projects?.[project];
if (typeof raw !== "string" || !raw.trim()) {
  process.exit(1);
}

let normalized = resolve(raw);
try {
  normalized = realpathSync(normalized);
} catch {
  // Keep resolved path when the directory does not exist yet.
}

process.stdout.write(`${normalized}\n`);
NODE
}

resolve_project_from_dir() {
  local dir="${1:?directory required}"

  node --input-type=module - "$KUMA_PROJECTS_PATH" "$dir" <<'NODE'
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

const [, , projectsPath, rawDir] = process.argv;
if (!existsSync(projectsPath)) {
  process.exit(1);
}

const projects = JSON.parse(readFileSync(projectsPath, "utf8"));
let target = resolve(rawDir);
try {
  target = realpathSync(target);
} catch {
  // Leave resolved path as-is when the directory does not exist yet.
}

let best = null;
for (const [projectId, projectDir] of Object.entries(projects ?? {})) {
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    continue;
  }

  let normalizedDir = resolve(projectDir);
  try {
    normalizedDir = realpathSync(normalizedDir);
  } catch {
    // Leave resolved path as-is when the directory does not exist yet.
  }

  if (target === normalizedDir || target.startsWith(`${normalizedDir}${sep}`)) {
    if (!best || normalizedDir.length > best.dir.length) {
      best = { id: projectId, dir: normalizedDir };
    }
  }
}

if (!best) {
  process.exit(1);
}

process.stdout.write(`${best.id}\n`);
NODE
}

save_project_mapping() {
  local project="${1:?project required}"
  local dir="${2:?directory required}"

  node --input-type=module - "$KUMA_PROJECTS_PATH" "$project" "$dir" <<'NODE'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [, , projectsPath, projectId, rawDir] = process.argv;
mkdirSync(dirname(projectsPath), { recursive: true });

let projects = {};
if (existsSync(projectsPath)) {
  projects = JSON.parse(readFileSync(projectsPath, "utf8"));
}

let normalizedDir = resolve(rawDir);
try {
  normalizedDir = realpathSync(normalizedDir);
} catch {
  // Leave resolved path as-is when the directory does not exist yet.
}

projects[projectId] = normalizedDir;
writeFileSync(projectsPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
process.stdout.write(`${normalizedDir}\n`);
NODE
}

member_display_label_from_json() {
  local member_json="${1:?member json required}"

  printf '%s' "$member_json" | node -e '
    const fs = require("node:fs");
    const member = JSON.parse(fs.readFileSync(0, "utf8"));
    const label = `${member.emoji || ""} ${member.displayName || member.id || ""}`.trim();
    process.stdout.write(`${label}\n`);
  '
}

register_surface_label() {
  local project="${1:?project required}"
  local label="${2:?label required}"
  local surface="${3:?surface required}"

  node --input-type=module - "$KUMA_SURFACES_PATH" "$project" "$label" "$surface" <<'NODE'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [, , registryPath, projectId, label, surface] = process.argv;
mkdirSync(dirname(registryPath), { recursive: true });

let registry = {};
if (existsSync(registryPath)) {
  registry = JSON.parse(readFileSync(registryPath, "utf8"));
}

const projectEntries = registry[projectId] && typeof registry[projectId] === "object"
  ? registry[projectId]
  : {};
projectEntries[label] = surface;
registry[projectId] = projectEntries;

writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
NODE
}

remove_surface_from_registry() {
  local surface="${1:?surface required}"
  local project="${2:-}"

  node --input-type=module - "$KUMA_SURFACES_PATH" "$surface" "$project" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [, , registryPath, surface, projectFilter] = process.argv;
if (!existsSync(registryPath)) {
  process.exit(0);
}

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const projectIds = projectFilter ? [projectFilter] : Object.keys(registry ?? {});

for (const projectId of projectIds) {
  const projectEntries = registry?.[projectId];
  if (!projectEntries || typeof projectEntries !== "object") {
    continue;
  }

  for (const [label, value] of Object.entries(projectEntries)) {
    if (String(value ?? "") === surface) {
      delete projectEntries[label];
    }
  }

  if (Object.keys(projectEntries).length === 0) {
    delete registry[projectId];
  } else {
    registry[projectId] = projectEntries;
  }
}

writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
NODE
}

resolve_project_anchor_surface() {
  local project="${1:?project required}"

  node --input-type=module - "$KUMA_SURFACES_PATH" "$project" <<'NODE'
import { existsSync, readFileSync } from "node:fs";

const [, , registryPath, projectId] = process.argv;
if (!existsSync(registryPath)) {
  process.exit(1);
}

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const projectEntries = registry?.[projectId];
if (!projectEntries || typeof projectEntries !== "object") {
  process.exit(1);
}

for (const surface of Object.values(projectEntries)) {
  if (typeof surface === "string" && surface.trim()) {
    process.stdout.write(`${surface}\n`);
    process.exit(0);
  }
}

process.exit(1);
NODE
}

resolve_member_json() {
  local query="${1:?member query required}"

  node --input-type=module - "$KUMA_TEAM_JSON_PATH" "$query" <<'NODE'
import { readFileSync } from "node:fs";

const [, , configPath, rawQuery] = process.argv;
const config = JSON.parse(readFileSync(configPath, "utf8"));
const members = Object.entries(config.teams ?? {}).flatMap(([teamId, team]) =>
  Array.isArray(team?.members)
    ? team.members.map((member) => {
      const spawnType = typeof member?.spawnType === "string" && member.spawnType
        ? member.spawnType
        : typeof member?.engine === "string" && member.engine
          ? member.engine
          : String(member?.spawnModel ?? member?.model ?? "").startsWith("gpt-") ? "codex" : "claude";
      return {
        displayName: String(member?.name ?? member?.id ?? ""),
        id: String(member?.id ?? ""),
        emoji: String(member?.emoji ?? ""),
        type: spawnType,
        team: String(member?.team ?? teamId ?? ""),
        defaultQa: typeof member?.defaultQa === "string" ? member.defaultQa : "",
      };
    })
    : [],
);

const query = String(rawQuery ?? "").trim();
const strippedQuery = query.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || query;
const loweredQuery = query.toLowerCase();
const loweredStripped = strippedQuery.toLowerCase();

function score(member) {
  const label = `${member.emoji} ${member.displayName}`.trim();
  const normalizedLabel = label.toLowerCase();
  const normalizedName = member.displayName.toLowerCase();
  const normalizedId = member.id.toLowerCase();
  const normalizedEmoji = member.emoji.toLowerCase();

  if (query === label) return 100;
  if (query === member.displayName) return 95;
  if (query === member.id) return 90;
  if (query === member.emoji) return 85;
  if (strippedQuery === member.displayName) return 80;
  if (loweredQuery === normalizedLabel) return 75;
  if (loweredQuery === normalizedName) return 70;
  if (loweredQuery === normalizedId) return 65;
  if (loweredQuery === normalizedEmoji) return 60;
  if (loweredStripped === normalizedName) return 55;
  if (normalizedLabel.includes(loweredQuery) && loweredQuery) return 40;
  if (normalizedName.includes(loweredStripped) && loweredStripped) return 35;
  return -1;
}

const match = members
  .map((member) => ({ member, score: score(member) }))
  .filter((entry) => entry.score >= 0)
  .sort((left, right) => right.score - left.score)[0];

if (!match) {
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(match.member)}\n`);
NODE
}

resolve_surface_json() {
  local project="${1:?project required}"
  local member_json="${2:?member json required}"

  node --input-type=module - "$KUMA_SURFACES_PATH" "$project" "$member_json" <<'NODE'
import { readFileSync } from "node:fs";

const [, , registryPath, requestedProject, rawMember] = process.argv;
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const member = JSON.parse(rawMember);

const seen = new Set();
const searchProjects = [
  requestedProject,
  member.team,
  ...Object.keys(registry ?? {}),
];

function parseLabel(label) {
  const text = String(label ?? "").trim();
  const emojiMatch = text.match(/^[\p{Extended_Pictographic}\uFE0F\s]+/u);
  const emoji = emojiMatch ? emojiMatch[0].replace(/\s+/gu, "").trim() : "";
  const name = text.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || text;
  return { text, name, emoji };
}

function matchesLabel(label) {
  const parsed = parseLabel(label);
  return (
    parsed.name === member.displayName ||
    parsed.text === member.displayName ||
    parsed.text === `${member.emoji} ${member.displayName}`.trim() ||
    parsed.emoji === member.emoji
  );
}

for (const projectId of searchProjects) {
  if (!projectId || seen.has(projectId)) {
    continue;
  }
  seen.add(projectId);

  const projectMembers = registry?.[projectId];
  if (!projectMembers || typeof projectMembers !== "object") {
    continue;
  }

  for (const [label, surface] of Object.entries(projectMembers)) {
    if (matchesLabel(label)) {
      process.stdout.write(`${JSON.stringify({ project: projectId, label, surface: String(surface) })}\n`);
      process.exit(0);
    }
  }
}

process.exit(1);
NODE
}

resolve_project_member_lines() {
  local project_filter="${1:-}"

  node --input-type=module - "$KUMA_TEAM_JSON_PATH" "$KUMA_SURFACES_PATH" "$project_filter" <<'NODE'
import { readFileSync } from "node:fs";

const [, , configPath, registryPath, projectFilter] = process.argv;
const config = JSON.parse(readFileSync(configPath, "utf8"));
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const membersByName = new Map(
  Object.entries(config.teams ?? {}).flatMap(([teamId, team]) =>
    Array.isArray(team?.members)
      ? team.members.map((member) => {
        const spawnType = typeof member?.spawnType === "string" && member.spawnType
          ? member.spawnType
          : typeof member?.engine === "string" && member.engine
            ? member.engine
            : String(member?.spawnModel ?? member?.model ?? "").startsWith("gpt-") ? "codex" : "claude";
        const displayName = String(member?.name ?? member?.id ?? "");
        return [displayName, {
          displayName,
          id: String(member?.id ?? ""),
          emoji: String(member?.emoji ?? ""),
          type: spawnType,
          team: String(member?.team ?? teamId ?? ""),
        }];
      })
      : [],
  ),
);

function parseLabel(label) {
  const text = String(label ?? "").trim();
  const emojiMatch = text.match(/^[\p{Extended_Pictographic}\uFE0F\s]+/u);
  const emoji = emojiMatch ? emojiMatch[0].replace(/\s+/gu, "").trim() : "";
  const name = text.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || text;
  return { name, emoji, text };
}

for (const [projectId, projectMembers] of Object.entries(registry ?? {})) {
  if (projectFilter && projectId !== projectFilter) {
    continue;
  }

  for (const [label, surface] of Object.entries(projectMembers ?? {})) {
    const parsed = parseLabel(label);
    if (/^(server|frontend)$/iu.test(parsed.name)) {
      continue;
    }

    const member = membersByName.get(parsed.name) ?? {
      displayName: parsed.name,
      id: parsed.name,
      emoji: parsed.emoji,
      type: "",
      team: "",
    };

    process.stdout.write([
      projectId,
      member.displayName,
      member.id,
      member.emoji || parsed.emoji,
      member.type,
      member.team,
      String(surface ?? ""),
    ].join("\t") + "\n");
  }
}
NODE
}

classify_surface_output_json() {
  local output="${1-}"

  node --input-type=module - "$output" <<'NODE'
const [, , output] = process.argv;

const PROMPT_LINE_PATTERN = /^(?:❯|>|›)\s*$/u;
const CODEX_SUGGESTION_LINE_PATTERN = /^›\s+\S/u;
const COMPLETED_SURFACE_PATTERN =
  /^[✻✶✳✢·]\s*(?:baked|brewed|cooked|toasted|charred|churned|saut(?:e|é)ed)\s+for\b/iu;
const WORKING_SURFACE_PATTERNS = [
  /^[✻✶✳✢·]\s*(?:concocting|thinking|meandering|fiddle-faddling|metamorphosing|working|reading\b).*(?:\.\.\.|…)?$/iu,
  /^•\s*working\s*\(/iu,
  /^•\s*thinking(?:\.\.\.|…)?$/iu,
  /\brunning(?:\.\.\.|…)/iu,
];
const IDLE_PROMPT_HINT_PATTERNS = [
  /^gpt-[\w.-]+(?:\s+.*)?$/iu,
  /^new task\?\s*\/clear to save \d+(?:\.\d+)?k tokens$/iu,
  /^\d+(?:\.\d+)?%\s+until auto-compact$/iu,
];
const SURFACE_HINT_PATTERNS = [
  /^compacting conversation(?:\.\.\.|…)?$/iu,
  /^compacted conversation\b/iu,
  /^tip:.*\/statusline\b/iu,
  /^\/statusline\b/iu,
  /^context left until auto-compact\b/iu,
  /^esc to\b/iu,
  /^press up to edit\b/iu,
  /^shift\+tab to cycle\b/iu,
  /^tab to queue\b/iu,
];
const BOX_DRAWING_PATTERN = /[\u2500-\u257F]/u;

function linesOf(text) {
  return String(text ?? "")
    .replace(/\r/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isPromptLine(line) {
  return PROMPT_LINE_PATTERN.test(String(line ?? "").trim());
}

function isSuggestionLine(line) {
  return CODEX_SUGGESTION_LINE_PATTERN.test(String(line ?? "").trim());
}

function isIdleHintLine(line) {
  const trimmed = String(line ?? "").trim();
  return IDLE_PROMPT_HINT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isIgnoredLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return true;
  if (BOX_DRAWING_PATTERN.test(trimmed)) return true;
  if (isSuggestionLine(trimmed) || isIdleHintLine(trimmed)) return true;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;
  return SURFACE_HINT_PATTERNS.some((pattern) => pattern.test(trimmed.replace(/^[^\p{L}\p{N}]+/u, "")));
}

const lines = linesOf(output);
let status = "idle";

if (!lines.length) {
  status = "dead";
} else if (/invalid_params|not a terminal|no such surface|surface .* not found|read failed|timed out|enoent|command not found|fatal|panic|traceback|uncaught exception|segmentation fault/iu.test(output)) {
  status = "dead";
} else if (lines.some((line) => COMPLETED_SURFACE_PATTERN.test(line))) {
  status = "idle";
} else {
  let lastInteractive = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (isPromptLine(line) || isSuggestionLine(line) || isIdleHintLine(line)) {
      lastInteractive = line;
      break;
    }
    if (isIgnoredLine(line)) {
      continue;
    }
    lastInteractive = line;
    break;
  }

  if (lastInteractive && (isPromptLine(lastInteractive) || isSuggestionLine(lastInteractive) || isIdleHintLine(lastInteractive))) {
    status = "idle";
  } else if (lines.some((line) => WORKING_SURFACE_PATTERNS.some((pattern) => pattern.test(line)))) {
    status = "working";
  } else if (lines.filter((line) => !isPromptLine(line) && !isIgnoredLine(line)).length > 0) {
    status = "working";
  }
}

const preview = [...lines]
  .reverse()
  .find((line) => !isPromptLine(line) && !isIgnoredLine(line))
  ?? "";

process.stdout.write(`${JSON.stringify({ status, preview })}\n`);
NODE
}

default_task_token() {
  local member_id="${1:?member id required}"
  printf '%s-%s\n' "$member_id" "$(date +%Y%m%d-%H%M%S)"
}

diagnose_surface_timeout() {
  local surface="${1:?surface required}"
  local output status_json status preview

  if output="$("$KUMA_CMUX_DIR/kuma-cmux-read.sh" "$surface" 2>&1)"; then
    status_json="$(classify_surface_output_json "$output")"
    status="$(printf '%s' "$status_json" | node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); console.log(data.status);')"
    preview="$(printf '%s' "$status_json" | node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); console.log((data.preview || "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim());')"
    printf 'WAIT_TIMEOUT_DIAG: surface=%s status=%s preview=%s\n' "$surface" "$status" "$preview" >&2
    return 0
  fi

  printf 'WAIT_TIMEOUT_DIAG: surface=%s status=dead preview=%s\n' \
    "$surface" \
    "$(printf '%s' "$output" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //; s/ $//')" >&2
}

wait_for_signal_with_diagnostics() {
  local signal="${1:?signal required}"
  local result_file="${2:-}"
  local surface="${3:-}"
  local timeout="${4:-900}"
  local output rc

  set +e
  output="$("$KUMA_CMUX_DIR/kuma-cmux-wait.sh" "$signal" "$result_file" --surface "$surface" --timeout "$timeout" 2>&1)"
  rc=$?
  set -e

  if [ -n "$output" ]; then
    printf '%s\n' "$output"
  fi

  if [ "$rc" -eq 0 ]; then
    return 0
  fi

  if printf '%s\n' "$output" | grep -q 'SIGNAL_TIMEOUT:'; then
    [ -n "$surface" ] && diagnose_surface_timeout "$surface"
    return 2
  fi

  return "$rc"
}

poll_result_file_with_diagnostics() {
  local result_file="${1:?result file required}"
  local surface="${2:-}"
  local timeout="${3:-900}"
  local elapsed=0
  local interval="$KUMA_WAIT_POLL_INTERVAL"

  while [ "$elapsed" -lt "$timeout" ]; do
    if [ -f "$result_file" ]; then
      printf 'RESULT_FILE: %s\n' "$result_file"
      cat "$result_file"
      return 0
    fi

    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  printf 'RESULT_POLL_TIMEOUT: %s (timeout=%ss)\n' "$result_file" "$timeout" >&2
  [ -n "$surface" ] && diagnose_surface_timeout "$surface"
  return 2
}
