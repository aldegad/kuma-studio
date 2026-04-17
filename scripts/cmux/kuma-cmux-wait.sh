#!/bin/bash
# Usage: kuma-cmux-wait.sh <signal-name> [result-file] [--surface <surface-id>] [--timeout <seconds>]
#
# Thin liveness helper: polls for a signal file and, when --surface is given,
# classifies the surface at timeout boundaries to report worker-down vs
# worker-idle. Does NOT record lifecycle events, run vault-ingest, or trigger
# Noeuri — those are owned by the dispatch broker (server.mjs) and the JS
# modules it imports (vault-lifecycle-hook.mjs, dispatch-auto-actions.mjs).
#
# Exits:
#   0 — signal file arrived
#   1 — timeout with worker-down classification (or unknown)
#   2 — timeout with worker-idle classification
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
KUMA_SURFACE_CLASSIFIER_CLI="${KUMA_SURFACE_CLASSIFIER_CLI:-$REPO_ROOT/packages/shared/surface-classifier-cli.mjs}"
KUMA_WAIT_POLL_INTERVAL="${KUMA_WAIT_POLL_INTERVAL:-5}"
SIGNAL_DIR="${KUMA_SIGNAL_DIR:-$HOME/.kuma/dispatch/signals}"

SIGNAL=""
RESULT_FILE=""
SURFACE=""
TIMEOUT=180
WAIT_REFERENCE_TIMESTAMP_MS="0"

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

initialize_signal_wait_reference() {
  # Use node for portable millisecond precision. BSD/macOS `date` lacks %3N.
  WAIT_REFERENCE_TIMESTAMP_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
}

signal_file_is_fresh() {
  local signal_path="$SIGNAL_DIR/$SIGNAL"
  [ -f "$signal_path" ] || return 1

  local mtime_ms=""
  mtime_ms="$(path_mtime_ms "$signal_path" 2>/dev/null || echo "")"
  [ -n "$mtime_ms" ] || return 1

  # Accept signal files created after we started waiting. A stale file from a
  # previous dispatch with the same name must not false-trigger this wait.
  [ "$mtime_ms" -ge "$WAIT_REFERENCE_TIMESTAMP_MS" ]
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

json_field() {
  local field="${1:?field required}"

  node -e '
const fs = require("node:fs");
const field = process.argv[1];
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

compact_preview() {
  printf '%s' "${1:-}" \
    | tr '\r\n' '  ' \
    | sed 's/[[:space:]]\+/ /g' \
    | sed 's/^ //; s/ $//'
}

print_signal_received() {
  printf 'SIGNAL_RECEIVED: %s\n' "$SIGNAL"
  if [ -n "$RESULT_FILE" ]; then
    printf 'RESULT_FILE: %s\n' "$RESULT_FILE"
  fi
}

wait_for_signal_once() {
  local timeout="$1"
  local elapsed=0
  local interval="${KUMA_WAIT_POLL_INTERVAL:-5}"

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

    elapsed=$((elapsed + wait_time))
  done

  return 1
}

classify_surface_on_timeout() {
  local status_json=""
  local status=""
  local preview=""
  local normalized_preview=""

  status_json="$(surface_status_json "$SURFACE")"
  status="$(printf '%s' "$status_json" | json_field status)"
  preview="$(printf '%s' "$status_json" | json_field preview)"
  normalized_preview="$(compact_preview "$preview")"

  case "$status" in
    working)
      printf 'SIGNAL_TIMEOUT_CONTINUE: signal=%s surface=%s timeout=%ss status=working preview=%s\n' \
        "$SIGNAL" "$SURFACE" "$TIMEOUT" "${normalized_preview:-n/a}" >&2
      return 3
      ;;
    idle)
      printf 'WORKER_IDLE_NO_SIGNAL: signal=%s surface=%s timeout=%ss preview=%s\n' \
        "$SIGNAL" "$SURFACE" "$TIMEOUT" "${normalized_preview:-n/a}" >&2
      return 2
      ;;
    *)
      printf 'WORKER_DOWN: signal=%s surface=%s timeout=%ss preview=%s\n' \
        "$SIGNAL" "$SURFACE" "$TIMEOUT" "${normalized_preview:-n/a}" >&2
      return 1
      ;;
  esac
}

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
  if wait_for_signal_once "$TIMEOUT"; then
    print_signal_received
    exit 0
  fi

  printf 'SIGNAL_TIMEOUT: %s (timeout=%ss)\n' "$SIGNAL" "$TIMEOUT" >&2
  exit 1
fi

while true; do
  if wait_for_signal_once "$TIMEOUT"; then
    print_signal_received
    exit 0
  fi

  set +e
  classify_surface_on_timeout
  rc=$?
  set -e

  case "$rc" in
    3)
      continue
      ;;
    *)
      exit "$rc"
      ;;
  esac
done
