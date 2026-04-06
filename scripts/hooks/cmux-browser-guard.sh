#!/bin/bash
# kuma 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

# Block cmux browser commands — use real Chrome instead
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
if echo "$cmd" | grep -qi 'cmux browser'; then
  echo '{"continue": false, "stopReason": "cmux browser 사용 금지. Chrome + Playwright 또는 유저에게 스크린샷 요청할 것."}'
else
  echo '{"continue": true}'
fi
