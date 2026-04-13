#!/bin/bash
# Usage: kuma-cmux-send.sh <surface> <prompt> [--workspace <workspace-id>] [--dry-run]
# Sends prompt text to a cmux surface, then submits it with a separate Enter keypress.
# Claude/Codex TUIs treat cmux send "\r" as a pasted newline, not a submit, so Enter
# must remain an explicit send-key step after the paste settles.
set -euo pipefail

RAW_SURFACE="${1:?surface required (e.g. surface:3)}"
PROMPT="${2:?prompt required}"

# Auto-prefix "surface:" if bare number passed
if [[ "$RAW_SURFACE" =~ ^[0-9]+$ ]]; then
  SURFACE="surface:${RAW_SURFACE}"
else
  SURFACE="$RAW_SURFACE"
fi
shift 2

WORKSPACE=""
DRY_RUN=0
KUMA_SEND_LOG_PATH="${KUMA_SEND_LOG_PATH:-/tmp/kuma-send.log}"

while [ $# -gt 0 ]; do
  case "$1" in
    --workspace)
      WORKSPACE="${2:?workspace required (e.g. workspace:1)}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

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

log_send() {
  local phase="${1:?phase required}"
  local payload="${2:-}"
  local normalized

  normalized="${payload//$'\r'/}"
  normalized="${normalized//$'\n'/\\n}"
  if [ ${#normalized} -gt 220 ]; then
    normalized="${normalized:0:220}..."
  fi

  mkdir -p "$(dirname "$KUMA_SEND_LOG_PATH")" 2>/dev/null || true
  printf '%s\t%s\tsurface=%s\tworkspace=%s\tpayload=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$phase" \
    "$SURFACE" \
    "${WORKSPACE:-auto}" \
    "$normalized" \
    >> "$KUMA_SEND_LOG_PATH" 2>/dev/null || true
}

if [ -z "$WORKSPACE" ]; then
  WORKSPACE="$(resolve_workspace "$SURFACE")"
fi

SEND_ARGS=()
READ_ARGS=()
if [ -n "$WORKSPACE" ]; then
  SEND_ARGS+=(--workspace "$WORKSPACE")
  READ_ARGS+=(--workspace "$WORKSPACE")
fi
SEND_ARGS+=(--surface "$SURFACE")
READ_ARGS+=(--surface "$SURFACE" --lines 12)

INTERACTIVE_LINE_PATTERN='^[[:space:]]*(❯|›|>|[$])'
SUGGESTION_LINE_PATTERN='^[[:space:]]*›[[:space:]]+[^[:space:]]'
EMPTY_PROMPT_LINE_PATTERN='^[[:space:]]*(❯|›|>|[$])[[:space:]]*$'
CMUX_TRANSIENT_SEND_ERROR_PATTERN='timed out|terminal surface not found|surface not found|internal_error|broken pipe|failed to write to socket'

read_input_view() {
  local screen

  screen=$(cmux read-screen "${READ_ARGS[@]}" 2>&1 || true)
  printf '%s\n' "$screen" | tail -n 8
}

views_differ() {
  local before="${1-}"
  local after="${2-}"
  [ "$before" != "$after" ]
}

last_interactive_line() {
  local view="${1-}"
  printf '%s\n' "$view" | grep -E "$INTERACTIVE_LINE_PATTERN" | tail -n 1 || true
}

blocking_suggestion_visible() {
  local last_line
  last_line="$(last_interactive_line "${1-}")"
  printf '%s\n' "$last_line" | grep -Eq "$SUGGESTION_LINE_PATTERN"
}

prompt_ready_for_send() {
  local last_line
  last_line="$(last_interactive_line "${1-}")"
  printf '%s\n' "$last_line" | grep -Eq "$EMPTY_PROMPT_LINE_PATTERN"
}

view_contains_transport_error() {
  local view="${1-}"
  printf '%s\n' "$view" | grep -Eiq "$CMUX_TRANSIENT_SEND_ERROR_PATTERN"
}

dismiss_blocking_suggestion() {
  # Suggestion은 텍스트 입력 시 자동 사라짐 — Escape 보내지 않는다.
  printf '%s\n' "${1-}"
}

if [ "$DRY_RUN" = "1" ]; then
  cmux read-screen "${READ_ARGS[@]}" > /dev/null
  log_send "dry-run" "$PROMPT"
  echo "DRY_RUN_OK $SURFACE${WORKSPACE:+ $WORKSPACE}"
  exit 0
fi

# Use last 30 chars for check — near the cursor, visible even for long wrapped prompts.
if [ ${#PROMPT} -le 30 ]; then
  CHECK="$PROMPT"
else
  CHECK="${PROMPT: -30}"
fi

prompt_still_pending() {
  local view="$1"
  local line
  local line_index=0
  local last_prompt_index=0
  local target_prompt_index=0

  while IFS= read -r line; do
    line_index=$((line_index + 1))
    if printf '%s\n' "$line" | grep -Eq "$INTERACTIVE_LINE_PATTERN"; then
      last_prompt_index=$line_index
      if [ -n "$CHECK" ] && printf '%s\n' "$line" | grep -F -- "$CHECK" > /dev/null; then
        target_prompt_index=$line_index
      fi
    fi
  done <<< "$view"

  [ "$target_prompt_index" -gt 0 ] && [ "$target_prompt_index" -eq "$last_prompt_index" ]
}

cmux_send_with_retry() {
  local attempt output rc

  for attempt in 1 2 3; do
    if output="$(cmux send "${SEND_ARGS[@]}" "$PROMPT" 2>&1)"; then
      [ -n "$output" ] && log_send "dispatch-output-$attempt" "$output"
      return 0
    fi

    rc=$?
    log_send "dispatch-retry-$attempt" "$output"
    if printf '%s\n' "$output" | grep -Eiq "$CMUX_TRANSIENT_SEND_ERROR_PATTERN" && [ "$attempt" -lt 3 ]; then
      sleep "$attempt"
      continue
    fi

    printf '%s\n' "$output" >&2
    return "$rc"
  done
}

cmux_send_key_with_retry() {
  local key="${1:?key required}"
  local attempt output rc

  for attempt in 1 2 3; do
    if output="$(cmux send-key "${SEND_ARGS[@]}" "$key" 2>&1)"; then
      [ -n "$output" ] && log_send "send-key-output-$attempt" "$output"
      return 0
    fi

    rc=$?
    log_send "send-key-retry-$attempt" "$output"
    if printf '%s\n' "$output" | grep -Eiq "$CMUX_TRANSIENT_SEND_ERROR_PATTERN" && [ "$attempt" -lt 3 ]; then
      sleep "$attempt"
      continue
    fi

    printf '%s\n' "$output" >&2
    return "$rc"
  done
}

MAX_RETRIES=3
PRE_SEND_VIEW="$(dismiss_blocking_suggestion "$(read_input_view)")"
log_send "pre-send" "$PRE_SEND_VIEW"

log_send "dispatch" "$PROMPT"
cmux_send_with_retry

# The paste can take a moment to settle in Claude/Codex TUIs. Re-fire Enter with
# gradually increasing delays so submit does not race ahead of the pasted prompt.
for enter_try in 1 2 3; do
  sleep "$enter_try"
  cmux_send_key_with_retry Enter
  sleep 0.5
  EARLY_VIEW="$(read_input_view)"
  if echo "$EARLY_VIEW" | grep -qE "Working \([0-9]+s"; then
    log_send "enter-accepted-try-$enter_try" "$EARLY_VIEW"
    break
  fi
  if views_differ "$PRE_SEND_VIEW" "$EARLY_VIEW" && ! prompt_still_pending "$EARLY_VIEW"; then
    log_send "enter-accepted-try-$enter_try" "$EARLY_VIEW"
    break
  fi
  log_send "enter-retry-$enter_try" "$EARLY_VIEW"
done

DELIVERED=false
for i in $(seq 1 $MAX_RETRIES); do
  sleep 1.2
  INPUT_VIEW="$(read_input_view)"

  if view_contains_transport_error "$INPUT_VIEW"; then
    echo "ERROR: transport error after send" >&2
    log_send "post-send-transport-error" "$INPUT_VIEW"
    break
  fi

  if ! views_differ "$PRE_SEND_VIEW" "$INPUT_VIEW"; then
    echo "RETRY $i: screen unchanged after send, retrying..." >&2
    log_send "retry-unchanged" "$INPUT_VIEW"
    cmux_send_key_with_retry Enter
  elif echo "$INPUT_VIEW" | grep -qE "Working \([0-9]+s"; then
    DELIVERED=true
    log_send "delivered-working" "$INPUT_VIEW"
    break
  elif prompt_still_pending "$INPUT_VIEW"; then
    echo "RETRY $i: Enter not registered, retrying..." >&2
    log_send "retry-enter" "$INPUT_VIEW"
    cmux_send_key_with_retry Enter
  else
    DELIVERED=true
    log_send "delivered" "$INPUT_VIEW"
    break
  fi
done

if [ "$DELIVERED" != true ]; then
  echo "ERROR: Prompt delivery failed after $MAX_RETRIES retries" >&2
  log_send "failed" "${INPUT_VIEW:-}"
  printf '%s\n' "$INPUT_VIEW" >&2
  exit 1
fi
