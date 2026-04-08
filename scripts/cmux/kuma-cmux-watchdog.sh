#!/bin/bash
# kuma-cmux-watchdog.sh — Autonomous worker session monitor
# Runs in an infinite loop, checking all worker surfaces every 2 minutes.
#
# ONLY intervenes when: prompt has unsent text (Enter not pressed).
# Idle/empty prompts = normal, don't touch.
#
# Alerts go to:
#   1. kuma (surface:1) via cmux send — kuma relays to Discord
#   2. /tmp/kuma-watchdog-alert.log — for polling
#
# Usage:
#   kuma-cmux-watchdog.sh              # infinite loop
#   kuma-cmux-watchdog.sh --once       # single pass (for testing)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INTERVAL_SECONDS=120
MAX_ENTER_RETRIES=3
ENTER_RETRY_WAIT=3
KUMA_SURFACE="surface:1"
KUMA_IDLE_ALERT_SECONDS=600  # 10 minutes

LOG="/tmp/kuma-watchdog.log"
ALERT_LOG="/tmp/kuma-watchdog-alert.log"
SURFACES_FILE="/tmp/kuma-surfaces.json"

KUMA_IDLE_SINCE=0

ONE_SHOT=false
if [[ "${1:-}" == "--once" ]]; then
  ONE_SHOT=true
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ts() { date '+%Y-%m-%d %H:%M:%S'; }

log() {
  echo "[$(ts)] $*" >> "$LOG"
}

# Alert: log + alert file + send to kuma surface for Discord relay
alert() {
  local msg="$*"
  local stamped="[$(ts)] $msg"
  echo "$stamped" >> "$LOG"
  echo "$stamped" >> "$ALERT_LOG"
  echo "$stamped" >&2

  # Send to kuma for Discord relay (non-blocking, best-effort)
  "$SCRIPT_DIR/kuma-cmux-send.sh" "$KUMA_SURFACE" "[watchdog] $msg" >/dev/null 2>&1 &
}

read_surface() {
  local surface="$1"
  cmux read-screen --surface "$surface" --lines 12 2>/dev/null || true
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

# ---------------------------------------------------------------------------
# Surface discovery
# ---------------------------------------------------------------------------

get_worker_surfaces() {
  if [[ ! -f "$SURFACES_FILE" ]]; then
    return
  fi

  python3 -c "
import json
with open('$SURFACES_FILE') as f:
    data = json.load(f)
skip_names = {'쭈니', '쿠마', 'server', 'frontend'}
seen = set()
for project, members in data.items():
    if project == 'system':
        continue
    for name, surface in members.items():
        clean = name.strip()
        if any(s in clean for s in skip_names) or surface in seen:
            continue
        seen.add(surface)
        print(f'{surface}\t{clean}')
" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Stuck prompt detection
# ---------------------------------------------------------------------------

# Returns 0 (true) if the screen shows a prompt with unsent text.
# Returns 1 (false) if prompt is empty, a Codex suggestion, or no prompt found.
detect_stuck_prompt() {
  local screen="$1"
  [[ -z "$screen" ]] && return 1

  # Only look at the bottom of the screen (last 6 lines).
  # Match prompt chars (❯ › >) followed by NON-EMPTY text.
  # Empty prompt (just ❯ + whitespace) = normal idle, skip.
  #
  # Codex (›) sessions always show suggestion placeholders like:
  #   › Run /review on my current changes
  #   › Write tests for @filename
  #   › Summarize recent commits
  # These are NOT stuck prompts — they are Codex's default suggestions.
  # Strategy: › prompts are only stuck if the text does NOT match
  # known Codex suggestion patterns.
  echo "$screen" | tail -6 | awk '
    /^[[:space:]]*[❯›>][[:space:]]*.+/ {
      line = $0

      # Detect if this is a Codex › prompt
      is_codex = (line ~ /^[[:space:]]*›/)

      sub(/^[[:space:]]*[❯›>][[:space:]]*/, "", line)

      # Skip Codex suggestion placeholders
      if (is_codex) {
        if (line ~ /^(Run \/|Write tests|Summarize recent|Review |Explain |Fix |Create |Add |Update |Generate |Refactor |Debug |Describe |List |Show |Check |Open |Search |Find |Help )/) next
        # Also skip if it looks like a dimmed suggestion (short generic text)
        if (line ~ /^[A-Z][a-z]+ / && length(line) < 60) next
      }

      # Must have substantive text (not just whitespace or cursor artifacts)
      trimmed = line
      gsub(/[[:space:]]/, "", trimmed)
      if (length(trimmed) > 2) {
        found = 1
      }
    }
    END { exit(found ? 0 : 1) }
  '
}

# ---------------------------------------------------------------------------
# Retry Enter
# ---------------------------------------------------------------------------

retry_enter() {
  local surface="$1"
  local name="$2"
  local ws
  ws="$(resolve_workspace "$surface")"

  local key_args=()
  [[ -n "$ws" ]] && key_args+=(--workspace "$ws")
  key_args+=(--surface "$surface")

  for attempt in $(seq 1 $MAX_ENTER_RETRIES); do
    log "$surface ($name) ENTER_RETRY attempt $attempt"
    cmux send-key "${key_args[@]}" Enter 2>/dev/null || true
    sleep "$ENTER_RETRY_WAIT"

    local recheck
    recheck="$(read_surface "$surface")"
    if ! detect_stuck_prompt "$recheck"; then
      log "$surface ($name) ✓ Enter delivered on attempt $attempt"
      return 0
    fi
  done

  alert "$surface ($name) ✗ STUCK — Enter retry failed after $MAX_ENTER_RETRIES attempts, needs manual check"
  return 1
}

# ---------------------------------------------------------------------------
# Check a single worker surface
# ---------------------------------------------------------------------------

check_worker() {
  local surface="$1"
  local name="$2"
  local screen

  screen="$(read_surface "$surface")"

  # Surface dead
  if [[ -z "$screen" ]]; then
    alert "$surface ($name) ✗ DEAD — read-screen failed"
    return
  fi

  # Working / active indicators — normal, skip
  if echo "$screen" | grep -qiE 'Working|thinking|Synthesizing|Searching|Reading|Editing|Running'; then
    log "$surface ($name) ⏳ working"
    return
  fi

  # Compacting — alert
  if echo "$screen" | grep -qiE 'Compacting|compressing'; then
    alert "$surface ($name) ⚠ COMPACTING — context limit"
    return
  fi

  # Shell only (no AI prompt) — alert
  if ! echo "$screen" | grep -qE '[❯›]' && echo "$screen" | tail -4 | grep -qE '^\$|^%'; then
    alert "$surface ($name) ⚠ SHELL_ONLY — AI session not running"
    return
  fi

  # Stuck prompt (text waiting for Enter) — THE MAIN TARGET
  if detect_stuck_prompt "$screen"; then
    alert "$surface ($name) ⚠ STUCK_PROMPT — text at prompt without Enter"
    retry_enter "$surface" "$name" || true
    return
  fi

  # Normal idle or unknown — just log, don't touch
  log "$surface ($name) ✓ ok"
}

# ---------------------------------------------------------------------------
# Check kuma (surface:1) — special handling
# ---------------------------------------------------------------------------

check_kuma() {
  local screen
  screen="$(read_surface "$KUMA_SURFACE")"

  if [[ -z "$screen" ]]; then
    alert "쿠마 ($KUMA_SURFACE) ✗ read failed — surface dead?"
    KUMA_IDLE_SINCE=0
    return
  fi

  # Compacting
  if echo "$screen" | grep -qiE 'Compacting|compressing'; then
    alert "쿠마 ($KUMA_SURFACE) ⚠ COMPACTING — context limit approaching"
    KUMA_IDLE_SINCE=0
    return
  fi

  # Working
  if echo "$screen" | grep -qiE 'Working|thinking|Synthesizing|Searching|Reading|Editing|Running'; then
    log "쿠마 ($KUMA_SURFACE) ⏳ working"
    KUMA_IDLE_SINCE=0
    return
  fi

  # Idle — track duration
  local now
  now=$(date +%s)
  if echo "$screen" | grep -qE '[❯›]' && ! detect_stuck_prompt "$screen"; then
    if [[ "$KUMA_IDLE_SINCE" -eq 0 ]]; then
      KUMA_IDLE_SINCE=$now
      log "쿠마 ($KUMA_SURFACE) ✓ idle"
    else
      local idle_duration=$(( now - KUMA_IDLE_SINCE ))
      if [[ "$idle_duration" -ge "$KUMA_IDLE_ALERT_SECONDS" ]]; then
        # Only alert once per threshold crossing (reset to avoid spam)
        alert "쿠마 ($KUMA_SURFACE) ⚠ idle for ${idle_duration}s — may need user input"
        KUMA_IDLE_SINCE=$now
      else
        log "쿠마 ($KUMA_SURFACE) ✓ idle (${idle_duration}s)"
      fi
    fi
    return
  fi

  # Stuck text on kuma prompt
  if detect_stuck_prompt "$screen"; then
    alert "쿠마 ($KUMA_SURFACE) ⚠ STUCK_PROMPT — text at prompt without Enter"
    # Don't auto-retry Enter on kuma — could be user's unfinished input
    KUMA_IDLE_SINCE=0
    return
  fi

  log "쿠마 ($KUMA_SURFACE) ? unknown state"
  KUMA_IDLE_SINCE=0
}

# ---------------------------------------------------------------------------
# Main cycle
# ---------------------------------------------------------------------------

run_cycle() {
  log "--- cycle start ---"

  check_kuma

  local workers
  workers="$(get_worker_surfaces)"

  if [[ -z "$workers" ]]; then
    log "No worker surfaces in $SURFACES_FILE"
    log "--- cycle end ---"
    return
  fi

  local stuck_count=0
  local total_count=0

  while IFS=$'\t' read -r surface name; do
    [[ -z "$surface" ]] && continue
    total_count=$(( total_count + 1 ))
    check_worker "$surface" "$name"
  done <<< "$workers"

  log "--- cycle end ($total_count workers checked) ---"
}

# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

log "=== watchdog started (interval=${INTERVAL_SECONDS}s, one_shot=$ONE_SHOT) ==="

if $ONE_SHOT; then
  run_cycle
  echo "Single pass complete. Logs: $LOG"
else
  while true; do
    run_cycle
    sleep "$INTERVAL_SECONDS"
  done
fi
