#!/bin/bash
set -euo pipefail

KUMA_HOME_DIR="${KUMA_HOME_DIR:-$HOME/.kuma}"
KUMA_CMUX_DIR="${KUMA_CMUX_DIR:-$KUMA_HOME_DIR/cmux}"
KUMA_TEAM_JSON_PATH="${KUMA_TEAM_JSON_PATH:-$KUMA_HOME_DIR/team.json}"
KUMA_SURFACES_PATH="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
KUMA_TASK_DIR="${KUMA_TASK_DIR:-/tmp/kuma-tasks}"
KUMA_RESULT_DIR="${KUMA_RESULT_DIR:-/tmp/kuma-results}"
KUMA_DEFAULT_PROJECT="${KUMA_DEFAULT_PROJECT:-kuma-studio}"
KUMA_DEFAULT_QA_MEMBER="${KUMA_DEFAULT_QA_MEMBER:-밤토리}"

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
