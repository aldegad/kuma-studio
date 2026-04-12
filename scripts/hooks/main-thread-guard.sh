#!/usr/bin/env bash
# main-thread-guard.sh — block synchronous polling that freezes the main thread
# Only active in kuma mode (gated by kuma-mode.lock)
# Detects for/while+sleep loops, seq+sleep patterns, and long standalone sleeps

# 쿠마 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue":true}'
  exit 0
fi

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
bg=$(echo "$input" | jq -r '.tool_input.run_in_background // false')

# Background execution doesn't block main thread — always allow
if [ "$bg" = "true" ]; then
  echo '{"continue":true}'
  exit 0
fi

# Flatten multiline commands for pattern matching
flat=$(printf '%s' "$cmd" | tr '\n' ' ')

# Block: for/while loops containing sleep (synchronous polling)
if echo "$flat" | grep -qE '(for[[:space:]]+.+;[[:space:]]*do|while[[:space:]]+.+;[[:space:]]*do).*sleep[[:space:]]+[0-9]'; then
  echo '{"continue":false,"stopReason":"⛔ 메인스레드 동기 폴링 차단! for/while+sleep 루프 감지. 대안: run_in_background=true 로 Bash 실행하거나 워커에게 위임."}'
  exit 0
fi

# Block: seq + sleep combination (common polling pattern)
if echo "$flat" | grep -qE 'seq[[:space:]]+[0-9].*sleep[[:space:]]+[0-9]'; then
  echo '{"continue":false,"stopReason":"⛔ 메인스레드 동기 폴링 차단! seq+sleep 패턴 감지. 대안: run_in_background=true 로 Bash 실행하거나 워커에게 위임."}'
  exit 0
fi

# Block: standalone sleep >= 30 seconds
sleep_val=$(echo "$flat" | grep -oE 'sleep[[:space:]]+[0-9]+' | head -1 | grep -oE '[0-9]+$')
if [ -n "$sleep_val" ] && [ "$sleep_val" -ge 30 ] 2>/dev/null; then
  echo '{"continue":false,"stopReason":"⛔ 메인스레드 장시간 sleep 차단! sleep '"$sleep_val"'s 감지. 대안: run_in_background=true 사용."}'
  exit 0
fi

echo '{"continue":true}'
