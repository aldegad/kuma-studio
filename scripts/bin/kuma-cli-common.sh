#!/bin/bash
set -euo pipefail

KUMA_CLI_COMMON_PATH="$(node -e 'const fs = require("node:fs"); const input = process.argv[1]; try { process.stdout.write(fs.realpathSync(input)); } catch { process.stdout.write(input); }' "${BASH_SOURCE[0]}")"
KUMA_CLI_COMMON_DIR="$(cd "$(dirname "$KUMA_CLI_COMMON_PATH")" && pwd)"

find_kuma_repo_root() {
  local dir="$KUMA_CLI_COMMON_DIR"

  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && [ -f "$dir/packages/server/src/cli.mjs" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

KUMA_HOME_DIR="${KUMA_HOME_DIR:-$HOME/.kuma}"
KUMA_VAULT_DIR="${KUMA_VAULT_DIR:-$KUMA_HOME_DIR/vault}"
KUMA_VAULT_RESULTS_DIR="${KUMA_VAULT_RESULTS_DIR:-$KUMA_VAULT_DIR/results}"
KUMA_CMUX_DIR="${KUMA_CMUX_DIR:-$KUMA_HOME_DIR/cmux}"
KUMA_TEAM_JSON_PATH="${KUMA_TEAM_JSON_PATH:-$KUMA_HOME_DIR/team.json}"
KUMA_PROJECTS_PATH="${KUMA_PROJECTS_PATH:-$KUMA_HOME_DIR/projects.json}"
KUMA_SURFACES_PATH="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
KUMA_TASK_DIR="${KUMA_TASK_DIR:-/tmp/kuma-tasks}"
KUMA_RESULT_DIR="${KUMA_RESULT_DIR:-/tmp/kuma-results}"
KUMA_DEFAULT_PROJECT="${KUMA_DEFAULT_PROJECT:-}"
KUMA_DEFAULT_QA_MEMBER="${KUMA_DEFAULT_QA_MEMBER:-밤토리}"
KUMA_DAEMON_URL="${KUMA_DAEMON_URL:-http://127.0.0.1:4312}"
KUMA_WAIT_POLL_INTERVAL="${KUMA_WAIT_POLL_INTERVAL:-5}"
KUMA_WAIT_TIMEOUT_EXTEND_BY="${KUMA_WAIT_TIMEOUT_EXTEND_BY:-600}"
KUMA_WAIT_TIMEOUT_MAX_EXTENSIONS="${KUMA_WAIT_TIMEOUT_MAX_EXTENSIONS:-3}"
KUMA_WAIT_TIMEOUT_MAX_TOTAL="${KUMA_WAIT_TIMEOUT_MAX_TOTAL:-2400}"
KUMA_AUTO_VAULT_INGEST="${KUMA_AUTO_VAULT_INGEST:-1}"
KUMA_AUTO_NOEURI_TRIGGER="${KUMA_AUTO_NOEURI_TRIGGER:-1}"
KUMA_AUTO_INGEST_STAMP_DIR="${KUMA_AUTO_INGEST_STAMP_DIR:-/tmp/kuma-vault-auto-ingest}"
KUMA_REPO_ROOT="${KUMA_REPO_ROOT:-$(find_kuma_repo_root || pwd)}"
KUMA_TEAM_NORMALIZER_CLI="${KUMA_TEAM_NORMALIZER_CLI:-$KUMA_REPO_ROOT/packages/shared/team-normalizer-cli.mjs}"
KUMA_SURFACE_CLASSIFIER_CLI="${KUMA_SURFACE_CLASSIFIER_CLI:-$KUMA_REPO_ROOT/packages/shared/surface-classifier-cli.mjs}"
KUMA_SURFACE_REGISTRY_CLI="${KUMA_SURFACE_REGISTRY_CLI:-$KUMA_REPO_ROOT/packages/shared/surface-registry-cli.mjs}"
KUMA_SERVER_CLI="${KUMA_SERVER_CLI:-$KUMA_REPO_ROOT/packages/server/src/cli.mjs}"
KUMA_DISPATCH_BIN="${KUMA_DISPATCH_BIN:-$KUMA_REPO_ROOT/scripts/bin/kuma-dispatch}"
KUMA_NOEURI_WATCHDOG_BIN="${KUMA_NOEURI_WATCHDOG_BIN:-$KUMA_REPO_ROOT/scripts/cmux/kuma-cmux-noeuri-watchdog.sh}"

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

resolve_default_project() {
  if [ -n "${KUMA_DEFAULT_PROJECT:-}" ]; then
    printf '%s\n' "$KUMA_DEFAULT_PROJECT"
    return 0
  fi

  resolve_project_from_dir "$(pwd)" 2>/dev/null || return 1
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

run_surface_registry_cli() {
  [ -f "$KUMA_SURFACE_REGISTRY_CLI" ] || die "surface registry bridge not found: $KUMA_SURFACE_REGISTRY_CLI"
  node "$KUMA_SURFACE_REGISTRY_CLI" "$@"
}

register_surface_label() {
  local project="${1:?project required}"
  local label="${2:?label required}"
  local surface="${3:?surface required}"
  run_surface_registry_cli upsert-label-surface "$KUMA_SURFACES_PATH" "$project" "$label" "$surface" > /dev/null
}

remove_surface_from_registry() {
  local surface="${1:?surface required}"
  local project="${2:-}"

  run_surface_registry_cli remove-surface "$KUMA_SURFACES_PATH" "$surface" "$project" > /dev/null
}

resolve_project_anchor_surface() {
  local project="${1:?project required}"

  run_surface_registry_cli resolve-project-anchor-surface "$KUMA_SURFACES_PATH" "$project"
}

resolve_member_json() {
  local query="${1:?member query required}"
  [ -f "$KUMA_TEAM_NORMALIZER_CLI" ] || die "team normalizer bridge not found: $KUMA_TEAM_NORMALIZER_CLI"
  node "$KUMA_TEAM_NORMALIZER_CLI" resolve-member-query "$KUMA_TEAM_JSON_PATH" "$query"
}

resolve_surface_json() {
  local project="${1:?project required}"
  local member_json="${2:?member json required}"

  run_surface_registry_cli resolve-member-context "$KUMA_SURFACES_PATH" "$project" "$member_json"
}

resolve_project_member_lines() {
  local project_filter="${1:-}"
  [ -f "$KUMA_TEAM_NORMALIZER_CLI" ] || die "team normalizer bridge not found: $KUMA_TEAM_NORMALIZER_CLI"
  node "$KUMA_TEAM_NORMALIZER_CLI" resolve-project-member-lines "$KUMA_TEAM_JSON_PATH" "$KUMA_SURFACES_PATH" "$project_filter"
}

classify_surface_output_json() {
  local output="${1-}"
  [ -f "$KUMA_SURFACE_CLASSIFIER_CLI" ] || die "surface classifier bridge not found: $KUMA_SURFACE_CLASSIFIER_CLI"
  printf '%s' "$output" | node "$KUMA_SURFACE_CLASSIFIER_CLI"
}

read_team_status_snapshot_json() {
  local project_filter="${1:-}"
  local args=("team-status" "--daemon-url" "$KUMA_DAEMON_URL")
  if [ -n "$project_filter" ]; then
    args+=("--project" "$project_filter")
  fi
  node "$KUMA_SERVER_CLI" "${args[@]}"
}

ensure_vault_results_dir() {
  mkdir -p "$KUMA_VAULT_RESULTS_DIR"
}

ingest_result_file_to_vault() {
  local result_file="${1:?result file required}"
  local destination=""

  if [ ! -f "$result_file" ]; then
    printf 'VAULT_RESULT_WARN: missing result file %s\n' "$result_file" >&2
    return 0
  fi

  ensure_vault_results_dir
  destination="$KUMA_VAULT_RESULTS_DIR/$(basename "$result_file")"
  cp "$result_file" "$destination"
  printf 'VAULT_RESULT_FILE: %s\n' "$destination"
}

ingest_missing_result_files_to_vault() {
  local source_file=""
  local destination=""
  local count=0
  local had_nullglob=0

  ensure_vault_results_dir

  if shopt -q nullglob; then
    had_nullglob=1
  else
    shopt -s nullglob
  fi

  for source_file in "$KUMA_RESULT_DIR"/*.result.md; do
    destination="$KUMA_VAULT_RESULTS_DIR/$(basename "$source_file")"
    if [ -f "$destination" ]; then
      continue
    fi
    cp "$source_file" "$destination"
    count=$((count + 1))
  done

  if [ "$had_nullglob" -eq 0 ]; then
    shopt -u nullglob
  fi

  printf '%s\n' "$count"
}

extract_auto_ingest_status() {
  local payload="${1:-}"

  printf '%s' "$payload" | node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(1);
const jsonStart = raw.indexOf("{");
if (jsonStart === -1) process.exit(1);
const data = JSON.parse(raw.slice(jsonStart));
if (typeof data.status === "string" && data.status.trim()) {
  process.stdout.write(data.status.trim());
}
' 2>/dev/null || true
}

default_task_token() {
  local member_id="${1:?member id required}"
  printf '%s-%s\n' "$member_id" "$(date +%Y%m%d-%H%M%S)"
}
