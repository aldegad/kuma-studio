#!/bin/bash
# Usage: kuma-cmux-health.sh
# Checks health of all cmux panes, reports dead sessions
set -euo pipefail

echo "=== cmux 세션 헬스체크 ==="

# Get all panes
PANES=$(cmux list-panes 2>&1)
echo "$PANES"
echo ""

# Check each surface
cmux tree 2>&1 | while IFS= read -r line; do
  if echo "$line" | grep -qE 'surface:[0-9]+'; then
    SURFACE=$(echo "$line" | grep -oE 'surface:[0-9]+')
    # Try reading screen
    SCREEN=$(cmux read-screen --surface "$SURFACE" --lines 3 2>&1)
    if [ $? -eq 0 ]; then
      # Check if it's a live claude/codex session or just a shell
      if echo "$SCREEN" | grep -qE '❯|›'; then
        echo "✓ $SURFACE — AI 세션 대기 중"
      elif echo "$SCREEN" | grep -qE 'Working|thinking|Synthesizing'; then
        echo "⏳ $SURFACE — 작업 중"
      elif echo "$SCREEN" | grep -qE '\$|%'; then
        echo "⚠ $SURFACE — 쉘 프롬프트 (AI 세션 없음)"
      else
        echo "? $SURFACE — 상태 불명"
      fi
    else
      echo "✗ $SURFACE — 읽기 실패"
    fi
  fi
done
