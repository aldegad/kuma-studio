#!/bin/bash
# Usage: kuma-cmux-send.sh <surface> <prompt> [--workspace <workspace-id>] [--dry-run]
# Sends prompt to a cmux surface, presses Enter, verifies delivery, and logs dispatches.
# Retries Enter up to 3 times if the text is still sitting at the prompt.
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

dismiss_blocking_suggestion() {
  local view="${1-}"

  # Suggestion은 텍스트 입력 시 자동 사라짐 — Escape 보내지 않는다.
  # Escape는 codex 상태를 꼬이게 만들어 이후 paste가 안 먹히는 원인이었다.
  if blocking_suggestion_visible "$view"; then
    log_send "suggestion-visible-will-auto-dismiss" "$view"
  fi
  printf '%s\n' "$view"
  return 0
}

if [ "$DRY_RUN" = "1" ]; then
  cmux read-screen "${READ_ARGS[@]}" > /dev/null
  log_send "dry-run" "$PROMPT"
  echo "DRY_RUN_OK $SURFACE${WORKSPACE:+ $WORKSPACE}"
  exit 0
fi

# Use last 30 chars for check — near the cursor, visible even for long wrapped prompts
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

  # Detect prompt lines from Claude Code (❯ ›), Codex (>), and shell ($).
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

MAX_RETRIES=3
PRE_SEND_VIEW="$(dismiss_blocking_suggestion "$(read_input_view)")"
log_send "pre-send" "$PRE_SEND_VIEW"

# Send the text WITHOUT trailing newline (Codex/Claude use bracketed paste;
# a \n inside pasted text is treated as a literal newline, not Enter).
log_send "dispatch" "$PROMPT"
cmux send "${SEND_ARGS[@]}" "$PROMPT"

# Enter를 점진적 딜레이로 3회 시도 (1초, 2초, 3초) — codex가 긴 paste 처리 중 Enter를 씹는 문제 대응.
for enter_try in 1 2 3; do
  sleep "$enter_try"
  cmux send-key "${SEND_ARGS[@]}" Enter
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

# Verify delivery — retry Enter if text is still at prompt
DELIVERED=false
for i in $(seq 1 $MAX_RETRIES); do
  sleep 1.2
  INPUT_VIEW="$(read_input_view)"

  if ! views_differ "$PRE_SEND_VIEW" "$INPUT_VIEW"; then
    echo "RETRY $i: screen unchanged after send, retrying..." >&2
    log_send "retry-unchanged" "$INPUT_VIEW"
    cmux send-key "${SEND_ARGS[@]}" Enter
  elif echo "$INPUT_VIEW" | grep -qE "Working \([0-9]+s"; then
    # Codex is actively working — delivery confirmed even if suggestion remnants linger.
    DELIVERED=true
    log_send "delivered-working" "$INPUT_VIEW"
    break
  elif prompt_still_pending "$INPUT_VIEW"; then
    echo "RETRY $i: Enter not registered, retrying..." >&2
    log_send "retry-enter" "$INPUT_VIEW"
    cmux send-key "${SEND_ARGS[@]}" Enter
  else
    # 화면이 바뀌었고 프롬프트에 텍스트 안 남아있으면 전달 완료.
    # suggestion 잔상은 무시 — codex가 Working 상태면 전달된 것.
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
