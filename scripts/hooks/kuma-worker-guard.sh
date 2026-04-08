#!/bin/bash
# kuma 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

# Blocks worker sessions from editing .claude/ files (skills, settings)
# Master session (no KUMA_ROLE) passes through

if [ "$KUMA_ROLE" != "worker" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Read tool input from stdin
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

if echo "$FILE_PATH" | grep -qE '\.claude/(skills|settings|memory)'; then
  echo "⚠️ 워커는 .claude/ 파일 수정 불가. 마스터에게 요청하세요. 결과 파일에 수정 요청을 기록하고 시그널을 보내세요."
  exit 2
else
  echo '{"continue": true}'
fi
