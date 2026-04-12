#!/bin/bash
KUMA_MODE_LOCK_PATH="${KUMA_MODE_LOCK_PATH:-/tmp/kuma-mode.lock}"
SPAWN_ALLOW_GLOB="${KUMA_AGENT_SPAWN_ALLOW_GLOB:-/tmp/kuma-agent-spawn-allow-*}"
SPAWN_ALLOW_TTL_SECONDS="${KUMA_AGENT_SPAWN_ALLOW_TTL_SECONDS:-600}"

consume_spawn_allow() {
  local now
  now=$(date +%s)

  local allow_path
  for allow_path in $SPAWN_ALLOW_GLOB; do
    [ -e "$allow_path" ] || continue
    [ -f "$allow_path" ] || continue

    local allow_mtime
    allow_mtime=$(stat -f %m "$allow_path" 2>/dev/null || echo "0")
    local allow_age=$((now - allow_mtime))

    if [ "$allow_age" -ge "$SPAWN_ALLOW_TTL_SECONDS" ]; then
      rm -f "$allow_path"
      continue
    fi

    local claim_path="${allow_path}.claimed.$$"
    if mv "$allow_path" "$claim_path" 2>/dev/null; then
      rm -f "$claim_path"
      return 0
    fi
  done

  return 1
}

# kuma 모드 아니면 통과
if [ ! -f "$KUMA_MODE_LOCK_PATH" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Workers는 통과
if [ "$KUMA_ROLE" = "worker" ]; then
  echo '{"continue": true}'
  exit 0
fi

# trusted wrapper가 만든 single-use scoped allow가 있으면 1회 통과
if consume_spawn_allow; then
  echo '{"continue": true}'
  exit 0
fi

# 그 외: 쿠마 모드에서 Agent 툴 사용 금지 — trusted wrapper scoped allow 필요
echo "⚠️ 쿠마는 Agent 직접 사용 금지. /kuma:dispatch 같은 trusted wrapper가 만든 scoped spawn allow 없이는 서브에이전트를 스폰할 수 없다." >&2
exit 2
