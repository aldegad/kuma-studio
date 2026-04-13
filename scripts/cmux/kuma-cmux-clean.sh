#!/bin/bash
# Usage: kuma-cmux-clean.sh [--dry-run] [-v|--verbose]
# Find cmux surfaces that are not registered in ~/.kuma/cmux/surfaces.json and close them.
set -euo pipefail

# Resolve script path through any symlink chain so this works when invoked
# via ~/.kuma/cmux/kuma-cmux-clean.sh as well as the repo path.
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
SCRIPT_NAME="$(basename "$SCRIPT_SOURCE")"

REGISTRY_PATH="${KUMA_SURFACES_PATH:-$HOME/.kuma/cmux/surfaces.json}"
CURRENT_SURFACE="${CMUX_SURFACE_ID:-}"
DRY_RUN=0
VERBOSE=0

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME [--dry-run] [-v|--verbose]

Close orphan cmux surfaces that are not registered in ${REGISTRY_PATH}.

Options:
  --dry-run      Print orphan surfaces without closing them
  -v, --verbose  Include workspace/title detail for preserved and orphan surfaces
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1" >&2
    exit 1
  }
}

warn() {
  echo "WARN: $*" >&2
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      -v|--verbose)
        VERBOSE=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "ERROR: unknown flag: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
}

parse_args "$@"

require_cmd cmux
require_cmd jq
require_cmd node

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kuma-cmux-clean.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

SURFACE_ROWS_PATH="$TMP_DIR/surfaces.tsv"
CLASSIFICATION_PATH="$TMP_DIR/classification.json"

strip_trailing_tags() {
  printf '%s\n' "$1" | sed -E -e ':again' -e 's/[[:space:]]+\[[^]]+\][[:space:]]*$//' -e 't again'
}

extract_workspace_title() {
  local line="$1"
  local without_prefix
  without_prefix="$(printf '%s\n' "$line" | sed -E 's/^[*[:space:]]*workspace:[0-9]+[[:space:]]+//')"
  strip_trailing_tags "$without_prefix" | sed -E 's/[[:space:]]+$//'
}

extract_surface_title() {
  local line="$1"
  local without_prefix
  without_prefix="$(printf '%s\n' "$line" | sed -E 's/^[*[:space:]]*surface:[0-9]+[[:space:]]+//')"
  strip_trailing_tags "$without_prefix" | sed -E 's/[[:space:]]+$//'
}

run_cmux_allow_failure() {
  local failure_message="$1"
  shift

  local output
  if ! output="$("$@" 2>&1)"; then
    output="$(printf '%s' "$output" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
    warn "${failure_message}: ${output:-unknown error}"
    return 1
  fi

  [ -n "$output" ] && printf '%s\n' "$output"
}

collect_surface_rows() {
  : > "$SURFACE_ROWS_PATH"

  local workspaces_output panes_output surfaces_output
  local workspace_line workspace_ref workspace_title
  local pane_line pane_ref
  local surface_line surface_ref surface_title

  workspaces_output="$(run_cmux_allow_failure \
    "cmux list-workspaces failed; keeping any undiscovered surfaces in place" \
    cmux list-workspaces)" || return 0

  while IFS= read -r workspace_line; do
    workspace_ref="$(printf '%s\n' "$workspace_line" | grep -oE 'workspace:[0-9]+' | head -1)"
    [ -n "$workspace_ref" ] || continue
    workspace_title="$(extract_workspace_title "$workspace_line")"

    panes_output="$(run_cmux_allow_failure \
      "cmux list-panes --workspace $workspace_ref failed; skipping workspace and keeping undiscovered surfaces in place" \
      cmux list-panes --workspace "$workspace_ref")" || continue

    while IFS= read -r pane_line; do
      pane_ref="$(printf '%s\n' "$pane_line" | grep -oE 'pane:[0-9]+' | head -1)"
      [ -n "$pane_ref" ] || continue

      surfaces_output="$(run_cmux_allow_failure \
        "cmux list-pane-surfaces --workspace $workspace_ref --pane $pane_ref failed; skipping pane and keeping undiscovered surfaces in place" \
        cmux list-pane-surfaces --workspace "$workspace_ref" --pane "$pane_ref")" || continue

      while IFS= read -r surface_line; do
        surface_ref="$(printf '%s\n' "$surface_line" | grep -oE 'surface:[0-9]+' | head -1)"
        [ -n "$surface_ref" ] || continue
        surface_title="$(extract_surface_title "$surface_line")"
        printf '%s\t%s\t%s\t%s\n' "$surface_ref" "$workspace_ref" "$workspace_title" "$surface_title" >> "$SURFACE_ROWS_PATH"
      done <<< "$surfaces_output"
    done <<< "$panes_output"
  done <<< "$workspaces_output"
}

collect_surface_rows

node --input-type=module - "$REGISTRY_PATH" "$SURFACE_ROWS_PATH" "$CURRENT_SURFACE" > "$CLASSIFICATION_PATH" <<'NODE'
import { existsSync, readFileSync } from "node:fs";

const [, , registryPath, surfaceRowsPath, currentSurface] = process.argv;

function readRegisteredSurfaces(path) {
  if (!existsSync(path)) {
    return new Set();
  }

  const registry = JSON.parse(readFileSync(path, "utf8"));
  const surfaces = [];
  for (const value of Object.values(registry ?? {})) {
    if (!value || typeof value !== "object") {
      continue;
    }
    for (const surface of Object.values(value)) {
      if (typeof surface === "string" && /^surface:\d+$/u.test(surface)) {
        surfaces.push(surface);
      }
    }
  }

  return new Set(surfaces);
}

function canonicalTitle(value) {
  return String(value ?? "")
    .replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/gu, "")
    .trim()
    .toLowerCase();
}

const registered = readRegisteredSurfaces(registryPath);
const rows = readFileSync(surfaceRowsPath, "utf8")
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => {
    const [surface, workspace, workspaceTitle = "", surfaceTitle = ""] = line.split("\t");
    return { surface, workspace, workspaceTitle, surfaceTitle };
  });

const preserved = [];
const orphans = [];

for (const row of rows) {
  if (registered.has(row.surface)) {
    preserved.push({ ...row, reason: "registered" });
    continue;
  }

  let reason = "";
  if (
    canonicalTitle(row.surfaceTitle) &&
    canonicalTitle(row.surfaceTitle) === canonicalTitle(row.workspaceTitle)
  ) {
    reason = "workspace-main";
  } else if (row.surface === "surface:1") {
    reason = "kuma-root";
  } else if (currentSurface && row.surface === currentSurface) {
    reason = "current-surface";
  }

  if (reason) {
    preserved.push({ ...row, reason });
    continue;
  }

  orphans.push(row);
}

process.stdout.write(`${JSON.stringify({ orphans, preserved }, null, 2)}\n`);
NODE

if [ "$VERBOSE" -eq 1 ]; then
  node --input-type=module - "$CLASSIFICATION_PATH" <<'NODE'
import { readFileSync } from "node:fs";

const [, , classificationPath] = process.argv;
const data = JSON.parse(readFileSync(classificationPath, "utf8"));

for (const entry of data.preserved ?? []) {
  process.stdout.write(`KEEP ${entry.surface}\t${entry.workspace}\t${entry.surfaceTitle}\treason=${entry.reason}\n`);
}

for (const entry of data.orphans ?? []) {
  process.stdout.write(`ORPHAN ${entry.surface}\t${entry.workspace}\t${entry.surfaceTitle}\n`);
}
NODE
fi

ORPHAN_COUNT="$(jq '.orphans | length' "$CLASSIFICATION_PATH")"
if [ "$ORPHAN_COUNT" -eq 0 ]; then
  echo "orphan 없음"
  exit 0
fi

ORPHAN_LIST="$(jq -r '.orphans | map(.surface) | join(", ")' "$CLASSIFICATION_PATH")"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry-run orphan ${ORPHAN_COUNT}개: ${ORPHAN_LIST}"
  exit 0
fi

while IFS=$'\t' read -r surface workspace _title; do
  [ -n "$surface" ] || continue
  [ -n "$workspace" ] || continue
  cmux close-surface --workspace "$workspace" --surface "$surface"
done < <(jq -r '.orphans[] | [.surface, .workspace, .surfaceTitle] | @tsv' "$CLASSIFICATION_PATH")

echo "orphan ${ORPHAN_COUNT}개 정리: ${ORPHAN_LIST}"
