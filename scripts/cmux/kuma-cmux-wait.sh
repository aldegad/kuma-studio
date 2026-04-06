#!/bin/bash
# Usage: kuma-cmux-wait.sh <signal-name> <result-file> [--surface <surface-id>] [--timeout <seconds>]
# Waits for a cmux signal and prints the result file contents when available.
set -euo pipefail

SIGNAL="${1:?signal name required}"
shift

RESULT_FILE=""
SURFACE=""
TIMEOUT=120
LEGACY_TIMEOUT=""
MAX_RETRIES=2

if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  RESULT_FILE="$1"
  shift
fi

if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  LEGACY_TIMEOUT="$1"
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

if [ -n "$LEGACY_TIMEOUT" ] && [ "$TIMEOUT" = "120" ]; then
  TIMEOUT="$LEGACY_TIMEOUT"
fi

print_result() {
  echo "SIGNAL_RECEIVED: $SIGNAL"
  if [ -n "$RESULT_FILE" ] && [ -f "$RESULT_FILE" ]; then
    echo "RESULT_FILE: $RESULT_FILE"
    cat "$RESULT_FILE"
  fi
  echo "DISCORD_REPORT_NEEDED"
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

surface_alive() {
  local surface="$1"
  local workspace=""
  local read_args=()

  workspace="$(resolve_workspace "$surface")"
  if [ -n "$workspace" ]; then
    read_args+=(--workspace "$workspace")
  fi
  read_args+=(--surface "$surface" --lines 1)

  cmux read-screen "${read_args[@]}" > /dev/null 2>&1
}

write_worker_down_error() {
  [ -n "$RESULT_FILE" ] || return 0
  mkdir -p "$(dirname "$RESULT_FILE")"
  cat > "$RESULT_FILE" <<EOF
# ERROR: Worker Down
surface: $SURFACE
signal: $SIGNAL
워커가 응답 없이 종료됨. 재스폰 필요.
EOF
}

wait_once() {
  local timeout="$1"
  cmux wait-for "$SIGNAL" --timeout "$timeout"
}

if [ -z "$SURFACE" ]; then
  if wait_once "$TIMEOUT"; then
    print_result
    exit 0
  fi

  echo "SIGNAL_TIMEOUT: $SIGNAL (timeout=${TIMEOUT}s)" >&2
  exit 1
fi

CURRENT_TIMEOUT="$TIMEOUT"
RETRY_COUNT=0

while true; do
  if wait_once "$CURRENT_TIMEOUT"; then
    print_result
    exit 0
  fi

  if ! surface_alive "$SURFACE"; then
    write_worker_down_error
    echo "WORKER_DOWN: $SURFACE" >&2
    exit 1
  fi

  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "SIGNAL_TIMEOUT: $SIGNAL (surface alive, retries exceeded)" >&2
    exit 2
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  CURRENT_TIMEOUT=$((CURRENT_TIMEOUT * 2))
  echo "SIGNAL_TIMEOUT_RETRY: $SIGNAL (surface=$SURFACE, retry=$RETRY_COUNT, timeout=${CURRENT_TIMEOUT}s)" >&2
done
