#!/bin/bash
# Usage: kuma-cmux-project-resync.sh <project> [--dry-run] [--dir <project-dir>]
set -euo pipefail

# Resolve script path through any symlink chain so this works when invoked
# via ~/.kuma/cmux/kuma-cmux-project-resync.sh as well as the repo path.
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SCRIPT_SOURCE" ]; do
  SCRIPT_DIR_TMP="$(cd -P "$(dirname "$SCRIPT_SOURCE")" >/dev/null 2>&1 && pwd)"
  SCRIPT_SOURCE="$(readlink "$SCRIPT_SOURCE")"
  case "$SCRIPT_SOURCE" in
    /*) ;;
    *) SCRIPT_SOURCE="$SCRIPT_DIR_TMP/$SCRIPT_SOURCE" ;;
  esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export KUMA_TEAM_JSON_PATH="${KUMA_TEAM_JSON_PATH:-$REPO_ROOT/packages/shared/team.json}"

source "$SCRIPT_DIR/kuma-cmux-team-config.sh"
source "$REPO_ROOT/scripts/bin/kuma-cli-common.sh"

PROJECT="${1:?project name required}"
shift || true

DRY_RUN=0
TARGET_DIR=""
REGISTRY_PATH="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
CURRENT_SURFACE="${CMUX_SURFACE_ID:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --dir)
      TARGET_DIR="${2:?directory required}"
      shift 2
      ;;
    *)
      echo "ERROR: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

require_cmd jq
require_team_config

resolve_target_dir() {
  local resolved=""

  if [ -n "$TARGET_DIR" ]; then
    resolved="$TARGET_DIR"
  else
    resolved="$(resolve_project_dir "$PROJECT" 2>/dev/null || true)"
    if [ -z "$resolved" ] && [ "$PROJECT" = "kuma-studio" ]; then
      resolved="$REPO_ROOT"
    fi
  fi

  [ -n "$resolved" ] || die "could not resolve project directory for $PROJECT"
  printf '%s\n' "$resolved"
}

load_target_members() {
  local member
  local seen=""

  while IFS= read -r member; do
    [ -n "$member" ] || continue
    if printf '%s\n' "$seen" | grep -Fqx "$member"; then
      continue
    fi
    seen="${seen}${member}"$'\n'
    TARGET_MEMBERS+=("$member")
  done < <(list_spawn_members)
}

lookup_existing_surface() {
  local member_name="$1"
  local label="$2"

  if [ ! -f "$REGISTRY_PATH" ]; then
    return 0
  fi

  jq -r \
    --arg project "$PROJECT" \
    --arg label "$label" \
    --arg member "$member_name" \
    '.[$project][$label] // .[$project][$member] // empty' \
    "$REGISTRY_PATH" 2>/dev/null || true
}

prune_project_registry_targets() {
  if [ ! -f "$REGISTRY_PATH" ]; then
    return 0
  fi

  printf '%s\n' "${TARGET_MEMBERS[@]}" | node --input-type=module - "$REGISTRY_PATH" "$PROJECT" "$KUMA_TEAM_JSON_PATH" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [, , registryPath, projectId, teamConfigPath] = process.argv;
if (!existsSync(registryPath)) {
  process.exit(0);
}

const targetNames = readFileSync(0, "utf8")
  .split(/\r?\n/u)
  .map((value) => value.trim())
  .filter(Boolean);
const targetNameSet = new Set(targetNames);

const config = JSON.parse(readFileSync(teamConfigPath, "utf8"));
const labels = new Set();
for (const team of Object.values(config.teams ?? {})) {
  for (const member of team?.members ?? []) {
    const name = String(member?.name ?? "").trim();
    if (!targetNameSet.has(name)) {
      continue;
    }
    const emoji = String(member?.emoji ?? "").trim();
    labels.add(name);
    labels.add(`${emoji} ${name}`.trim());
  }
}

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const projectEntries = registry?.[projectId];
if (!projectEntries || typeof projectEntries !== "object") {
  process.exit(0);
}

for (const label of Object.keys(projectEntries)) {
  if (labels.has(label)) {
    delete projectEntries[label];
  }
}

if (Object.keys(projectEntries).length === 0) {
  delete registry[projectId];
} else {
  registry[projectId] = projectEntries;
}

writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
NODE
}

TARGET_DIR="$(resolve_target_dir)"
declare -a TARGET_MEMBERS=()
load_target_members

if [ "${#TARGET_MEMBERS[@]}" -eq 0 ]; then
  die "no non-system project members found in $KUMA_TEAM_JSON_PATH"
fi

declare -a EXISTING_SURFACES=()
SURFACE_SEEN=""
declare -i EXISTING_TARGET_COUNT=0

printf 'PROJECT: %s\n' "$PROJECT"
printf 'TEAM_JSON: %s\n' "$KUMA_TEAM_JSON_PATH"
printf 'DIR: %s\n' "$TARGET_DIR"
printf 'TARGET_UNIQUE_MEMBERS: %d\n' "${#TARGET_MEMBERS[@]}"

if [ "${#TARGET_MEMBERS[@]}" -eq 11 ]; then
  printf 'TASK_NOTE: task text still says "11 existing + 슉슉이 = 12"; canonical packages/shared/team.json currently resolves to 11 unique non-system members including 슉슉이.\n'
fi

echo "PLAN:"
for idx in "${!TARGET_MEMBERS[@]}"; do
  member_name="${TARGET_MEMBERS[$idx]}"
  label="$(member_display_label "$member_name")"
  existing_surface="$(lookup_existing_surface "$member_name" "$label")"

  if [ -n "$existing_surface" ]; then
    action="kill+respawn"
    EXISTING_TARGET_COUNT+=1
    if ! printf '%s\n' "$SURFACE_SEEN" | grep -Fqx "$existing_surface"; then
      SURFACE_SEEN="${SURFACE_SEEN}${existing_surface}"$'\n'
      EXISTING_SURFACES+=("$existing_surface")
    fi
  else
    action="spawn"
  fi

  printf '  [%02d/%02d] %s existing=%s action=%s\n' \
    "$((idx + 1))" "${#TARGET_MEMBERS[@]}" "$label" "${existing_surface:-none}" "$action"
done

printf 'SUMMARY: existing-target-surfaces=%d missing-target-surfaces=%d\n' \
  "$EXISTING_TARGET_COUNT" "$(( ${#TARGET_MEMBERS[@]} - EXISTING_TARGET_COUNT ))"
printf 'EXEC: KUMA_TEAM_JSON_PATH=%q %q %q %q\n' \
  "$KUMA_TEAM_JSON_PATH" "$SCRIPT_DIR/kuma-cmux-project-init.sh" "$PROJECT" "$TARGET_DIR"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY_RUN: registry and cmux surfaces left untouched."
  exit 0
fi

mkdir -p "$(dirname "$REGISTRY_PATH")"
if [ ! -f "$REGISTRY_PATH" ]; then
  printf '{}\n' > "$REGISTRY_PATH"
fi

for surface in "${EXISTING_SURFACES[@]}"; do
  if [ -n "$CURRENT_SURFACE" ] && [ "$surface" = "$CURRENT_SURFACE" ]; then
    die "refusing to kill current surface $CURRENT_SURFACE"
  fi

  "$SCRIPT_DIR/kuma-cmux-kill.sh" "$surface" > /dev/null 2>&1 || true
  remove_surface_from_registry "$surface" "$PROJECT"
done

prune_project_registry_targets

KUMA_TEAM_JSON_PATH="$KUMA_TEAM_JSON_PATH" \
  "$SCRIPT_DIR/kuma-cmux-project-init.sh" "$PROJECT" "$TARGET_DIR"
