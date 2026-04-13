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

INTERACTIVE_LINE_PATTERN='^[[:space:]]*(❯|›|>|[$]|([[:alnum:]_-]+[[:space:]]+)*[[:alnum:]_-]+>)([[:space:]].*)?$'
SUGGESTION_LINE_PATTERN='^[[:space:]]*›[[:space:]]+[^[:space:]]'
EMPTY_PROMPT_LINE_PATTERN='^[[:space:]]*(❯|›|>|[$])[[:space:]]*$'
SHELL_CONTINUATION_LINE_PATTERN='^[[:space:]]*([[:alnum:]_-]+[[:space:]]+)*[[:alnum:]_-]+>[[:space:]]*.*$'
CMUX_TRANSIENT_SEND_ERROR_PATTERN='timed out|terminal surface not found|surface not found|internal_error|broken pipe|failed to write to socket'
BOX_DRAWING_LINE_PATTERN='^[[:space:]]*[─━═]{3,}[[:space:]]*$'
TRAILING_HINT_LINE_PATTERN='^[[:space:]]*(⏵⏵.*bypass|Now using extra usage|extra credit|Tip:|Press up to edit|Shift\+Tab to cycle|Tab to queue|/statusline|context left until auto-compact|new task\?|gpt-[[:alnum:].-]+|~?[0-9]+([.][0-9]+)?k uncached|[0-9]+([.][0-9]+)?% until auto-compact|esc to .*)'

read_input_view() {
  local screen

  screen=$(cmux read-screen "${READ_ARGS[@]}" 2>&1 || true)
  printf '%s\n' "$screen" | tail -n 8
}

line_is_tail_footer() {
  local line

  line="$(printf '%s' "${1-}" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -z "$line" ] && return 0

  printf '%s\n' "$line" | grep -Eq "$BOX_DRAWING_LINE_PATTERN" && return 0
  printf '%s\n' "$line" | grep -Eq "$TRAILING_HINT_LINE_PATTERN" && return 0
  return 1
}

last_relevant_line() {
  local view="${1-}"
  local lines=()
  local line
  local index

  while IFS= read -r line || [ -n "$line" ]; do
    lines+=("$line")
  done <<< "$view"

  for ((index=${#lines[@]} - 1; index >= 0; index--)); do
    line="${lines[$index]}"
    if line_is_tail_footer "$line"; then
      continue
    fi
    printf '%s\n' "$line"
    return 0
  done

  return 1
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

prompt_still_pending() {
  local last_line

  last_line="$(last_relevant_line "${1-}" || true)"
  [ -n "$last_line" ] || return 1
  printf '%s\n' "$last_line" | grep -Eq "$INTERACTIVE_LINE_PATTERN" || return 1
  printf '%s\n' "$last_line" | grep -Eq "$EMPTY_PROMPT_LINE_PATTERN" && return 1
  printf '%s\n' "$last_line" | grep -Eq "$SUGGESTION_LINE_PATTERN" && return 1
  return 0
}

wait_for_pending_paste_settle() {
  local previous="" current="" stable_reads=0 pending_seen=false
  local attempt

  for attempt in $(seq 1 18); do
    current="$(read_input_view)"

    if view_contains_transport_error "$current"; then
      log_send "pre-enter-transport-error" "$current"
      printf '%s\n' "$current"
      return 0
    fi

    if views_differ "$PRE_SEND_VIEW" "$current" && ! prompt_still_pending "$current"; then
      log_send "pre-enter-cleared" "$current"
      printf '%s\n' "$current"
      return 0
    fi

    if views_differ "$PRE_SEND_VIEW" "$current"; then
      pending_seen=true
      if [ "$(last_relevant_line "$current" || true)" = "$previous" ]; then
        stable_reads=$((stable_reads + 1))
      else
        stable_reads=0
      fi

      if [ "$stable_reads" -ge 1 ]; then
        log_send "pre-enter-settled" "$current"
        printf '%s\n' "$current"
        return 0
      fi
      previous="$(last_relevant_line "$current" || true)"
    fi

    sleep 0.2
  done

  if [ "$pending_seen" = true ]; then
    log_send "pre-enter-timeout" "$current"
  fi
  printf '%s\n' "$current"
}

ENTER_CONFIRM_STATUS=""
ENTER_CONFIRM_VIEW=""

wait_for_enter_effect() {
  local before="${1-}"
  local current=""
  local attempt

  ENTER_CONFIRM_STATUS="pending"
  ENTER_CONFIRM_VIEW=""

  for attempt in $(seq 1 10); do
    sleep 0.2
    current="$(read_input_view)"
    ENTER_CONFIRM_VIEW="$current"

    if view_contains_transport_error "$current"; then
      ENTER_CONFIRM_STATUS="transport-error"
      return 0
    fi

    if echo "$current" | grep -qE "Working \([0-9]+s"; then
      ENTER_CONFIRM_STATUS="delivered-working"
      return 0
    fi

    if views_differ "$before" "$current" && ! prompt_still_pending "$current"; then
      ENTER_CONFIRM_STATUS="delivered"
      return 0
    fi
  done

  if [ -z "$ENTER_CONFIRM_VIEW" ]; then
    ENTER_CONFIRM_VIEW="$(read_input_view)"
  fi

  if ! views_differ "$before" "$ENTER_CONFIRM_VIEW"; then
    ENTER_CONFIRM_STATUS="unchanged"
  elif prompt_still_pending "$ENTER_CONFIRM_VIEW"; then
    ENTER_CONFIRM_STATUS="pending"
  else
    ENTER_CONFIRM_STATUS="delivered"
  fi
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
wait_for_pending_paste_settle > /dev/null

# Submit as soon as the pasted tail settles on screen, then verify via
# short follow-up reads instead of relying on fixed 1s/2s/3s delays.
DELIVERED=false
INPUT_VIEW=""
for enter_try in $(seq 1 "$MAX_RETRIES"); do
  cmux_send_key_with_retry Enter
  wait_for_enter_effect "$PRE_SEND_VIEW"
  INPUT_VIEW="$ENTER_CONFIRM_VIEW"

  if [ "$ENTER_CONFIRM_STATUS" = "delivered-working" ]; then
    log_send "enter-accepted-try-$enter_try" "$INPUT_VIEW"
    log_send "delivered-working" "$INPUT_VIEW"
    DELIVERED=true
    break
  fi

  if [ "$ENTER_CONFIRM_STATUS" = "delivered" ]; then
    log_send "enter-accepted-try-$enter_try" "$INPUT_VIEW"
    log_send "delivered" "$INPUT_VIEW"
    DELIVERED=true
    break
  fi

  if [ "$ENTER_CONFIRM_STATUS" = "transport-error" ]; then
    echo "ERROR: transport error after send" >&2
    log_send "post-send-transport-error" "$INPUT_VIEW"
    break
  fi

  if [ "$ENTER_CONFIRM_STATUS" = "unchanged" ]; then
    echo "RETRY $enter_try: screen unchanged after send, retrying..." >&2
    log_send "retry-unchanged" "$INPUT_VIEW"
  else
    echo "RETRY $enter_try: Enter not registered, retrying..." >&2
    log_send "retry-enter" "$INPUT_VIEW"
  fi
done

if [ "$DELIVERED" != true ]; then
  echo "ERROR: Prompt delivery failed after $MAX_RETRIES retries" >&2
  log_send "failed" "${INPUT_VIEW:-}"
  printf '%s\n' "$INPUT_VIEW" >&2
  exit 1
fi
