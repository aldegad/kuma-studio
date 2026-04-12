#!/bin/bash
# .claude/plans/ 사용 차단 → .kuma/plans/ 사용 유도

# 쿠마 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')

if echo "$file_path" | grep -qE '\.claude/plans/'; then
  echo "⚠️ .claude/plans/는 사용 금지. ~/.kuma/plans/{프로젝트명}/에 쿠마 스튜디오 포맷으로 작성하세요."
  exit 2
fi

echo '{"continue": true}'
