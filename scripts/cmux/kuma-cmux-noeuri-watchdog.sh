#!/bin/bash
# kuma-cmux-noeuri-watchdog.sh
# Periodically scans for result files that did not flow through kuma-cmux-wait.sh
# and dispatches a trusted Noeuri ingest task when new backlog is detected.
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
RESULT_DIR="${KUMA_RESULT_DIR:-$HOME/.kuma/dispatch/results}"
STAMP_PATH="${KUMA_NOEURI_LAST_INGEST_TIMESTAMP:-$HOME/.kuma/runtime/noeuri-last-ingest.timestamp}"
INTERVAL_SECONDS="${KUMA_NOEURI_WATCHDOG_INTERVAL_SECONDS:-300}"
LOG_PATH="${KUMA_NOEURI_WATCHDOG_LOG_PATH:-$HOME/.kuma/runtime/noeuri-watchdog.log}"
PROJECT="${KUMA_NOEURI_WATCHDOG_PROJECT:-kuma-studio}"
DEFAULT_TASK_BIN="$REPO_ROOT/scripts/bin/kuma-task"

if [ -x "$DEFAULT_TASK_BIN" ]; then
  TASK_BIN="${KUMA_TASK_BIN_PATH:-$DEFAULT_TASK_BIN}"
else
  TASK_BIN="${KUMA_TASK_BIN_PATH:-$HOME/.kuma/bin/kuma-task}"
fi

ONE_SHOT=false

usage() {
  cat <<'EOF'
Usage: kuma-cmux-noeuri-watchdog.sh [--once] [--interval <seconds>]
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --once)
      ONE_SHOT=true
      shift
      ;;
    --interval)
      INTERVAL_SECONDS="${2:?interval seconds required}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'ERROR: unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

ts() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  mkdir -p "$(dirname "$LOG_PATH")"
  printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG_PATH"
}

require_executable() {
  local path="${1:?path required}"
  [ -x "$path" ] || {
    printf 'ERROR: executable not found: %s\n' "$path" >&2
    exit 1
  }
}

create_scan_marker() {
  local marker
  marker="$(mktemp "${TMPDIR:-/tmp}/kuma-noeuri-watchdog.XXXXXX")"
  touch "$marker"
  printf '%s\n' "$marker"
}

collect_pending_results() {
  local reference_path="${1:-}"

  [ -d "$RESULT_DIR" ] || return 0

  if [ -n "$reference_path" ] && [ -e "$reference_path" ]; then
    find "$RESULT_DIR" -type f -name '*.result.md' -newer "$reference_path" \
      ! -name '*-noeuri-*.result.md' \
      ! -name 'noeuri-audit-*.result.md' | LC_ALL=C sort
  else
    find "$RESULT_DIR" -type f -name '*.result.md' \
      ! -name '*-noeuri-*.result.md' \
      ! -name 'noeuri-audit-*.result.md' | LC_ALL=C sort
  fi
}

build_instruction() {
  local count="${1:?count required}"
  shift
  local -a result_paths=("$@")
  local index=0

  printf '미처리 result 인제스트\n\n'
  printf 'source: kuma-cmux-noeuri-watchdog\n'
  printf 'project: %s\n' "$PROJECT"
  printf 'result_dir: %s\n' "$RESULT_DIR"
  printf 'pending_count: %s\n\n' "$count"
  printf 'pending_results:\n'
  for result_path in "${result_paths[@]}"; do
    index=$((index + 1))
    if [ "$index" -le 10 ]; then
      printf -- '- %s\n' "$result_path"
    fi
  done

  if [ "$count" -gt 10 ]; then
    printf -- '- ... (%s more)\n' "$((count - 10))"
  fi
}

dispatch_pending_results() {
  local scan_marker="${1:?scan marker required}"
  local reference_path=""
  local -a pending_results=()
  local instruction=""
  local pending_result=""

  if [ -f "$STAMP_PATH" ]; then
    reference_path="$STAMP_PATH"
  fi

  while IFS= read -r pending_result; do
    [ -n "$pending_result" ] || continue
    pending_results+=("$pending_result")
  done < <(collect_pending_results "$reference_path")

  if [ "${#pending_results[@]}" -eq 0 ]; then
    log "no pending result backlog"
    return 0
  fi

  instruction="$(build_instruction "${#pending_results[@]}" "${pending_results[@]}")"
  log "dispatching Noeuri ingest for ${#pending_results[@]} result(s)"

  if "$TASK_BIN" noeuri "$instruction" --project "$PROJECT" --trust-worker >> "$LOG_PATH" 2>&1; then
    mkdir -p "$(dirname "$STAMP_PATH")"
    mv "$scan_marker" "$STAMP_PATH"
    log "dispatch complete; stamp updated: $STAMP_PATH"
    return 10
  fi

  log "dispatch failed; stamp left unchanged"
  return 1
}

main() {
  local scan_marker=""
  local dispatched=0

  require_executable "$TASK_BIN"
  log "=== noeuri watchdog started (interval=${INTERVAL_SECONDS}s, one_shot=${ONE_SHOT}) ==="

  while true; do
    scan_marker="$(create_scan_marker)"
    dispatched=0

    if dispatch_pending_results "$scan_marker"; then
      :
    else
      dispatched=$?
    fi

    if [ "$dispatched" -ne 10 ]; then
      rm -f "$scan_marker"
    fi

    if $ONE_SHOT; then
      break
    fi

    sleep "$INTERVAL_SECONDS"
  done
}

main "$@"
