#!/bin/bash
# kuma 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

# Workers는 통과
if [ "$KUMA_ROLE" = "worker" ]; then
  echo '{"continue": true}'
  exit 0
fi

# dispatch lock이 있으면 통과 (디스패치 스킬에서 서브에이전트 스폰용)
if [ -f /tmp/kuma-dispatch.lock ]; then
  lock_age=$(($(date +%s) - $(stat -f %m /tmp/kuma-dispatch.lock 2>/dev/null || echo "0")))
  if [ "$lock_age" -lt 600 ]; then
    echo '{"continue": true}'
    exit 0
  fi
fi

# 그 외: 쿠마 모드에서 Agent 툴 사용 금지 — /kuma:dispatch 스킬을 먼저 사용할 것
echo "⚠️ 쿠마는 Agent 직접 사용 금지. /kuma:dispatch 스킬로 dispatch lock을 먼저 생성한 뒤 서브에이전트를 스폰할 것."
exit 2
