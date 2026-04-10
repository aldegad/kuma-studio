#!/bin/bash
# kuma-bash-guard v2 — 전면 차단 + dispatch lock 기반 허용
# 쿠마 모드에서 Bash 직접 호출을 원칙적으로 금지
# 워커 작업은 /kuma:dispatch 스킬 → 서브에이전트를 통해서만 실행

# 쿠마 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# cmux browser는 누구든 차단
if echo "$cmd" | grep -qE '^\s*cmux\s+browser'; then
  echo "⚠️ cmux browser 사용 금지. Playwright headless 사용할 것." >&2
  exit 2
fi

# Workers (KUMA_ROLE=worker) — cmux browser 외 전부 통과
if [ "$KUMA_ROLE" = "worker" ]; then
  echo '{"continue": true}'
  exit 0
fi

# 신뢰된 래퍼는 dispatch lock 없이도 통과
if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~/\.kuma/bin/)?kuma-task(\s|$)'; then
  echo '{"continue": true}'
  exit 0
fi

if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~/\.kuma/cmux/)?kuma-cmux-send\.sh(\s|$)'; then
  echo '{"continue": true}'
  exit 0
fi

# raw cmux send/send-key는 직접 호출 금지
if echo "$cmd" | grep -qE '^\s*cmux\s+(send|send-key)(\s|$)'; then
  echo "⚠️ raw cmux send/send-key 사용 금지. ~/.kuma/cmux/kuma-cmux-send.sh 를 사용할 것." >&2
  exit 2
fi

# ============================================================
# 이하 쿠마 메인 스레드 전용 규칙
# 원칙: 스킬 + Discord 외에는 아무것도 못 함
# ============================================================

# === 항상 허용: 읽기전용 즉시 완료 명령 ===

# kuma-status (워커 상태 조회)
if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~/\.kuma/bin/)?kuma-status(\s|$)'; then
  echo '{"continue": true}'; exit 0
fi

# ls: /tmp/kuma-*, ~/.kuma/, ~/.claude/, output/playwright/ (파일 존재 확인)
if echo "$cmd" | grep -qE '^\s*ls\s+(-[a-zA-Z]+\s+)*(/tmp/kuma-|.*/\.kuma/|.*/\.claude/|.*/output/playwright)'; then
  echo '{"continue": true}'; exit 0
fi

# === dispatch lock 있을 때만 허용 (서브에이전트용) ===
if [ -f /tmp/kuma-dispatch.lock ]; then
  # lock이 10분 이상 오래되면 무시 (stale lock 방지)
  lock_age=$(($(date +%s) - $(stat -f %m /tmp/kuma-dispatch.lock 2>/dev/null || echo "0")))
  if [ "$lock_age" -lt 600 ]; then

    # kuma CLI 래퍼
    if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~/\.kuma/bin/)?kuma-(task|spawn|read|kill|project-init)(\s|$)'; then
      echo '{"continue": true}'; exit 0
    fi

    # cmux 운영 명령 (read-screen, wait-for, tree, identify, close-surface, new-surface)
    if echo "$cmd" | grep -qE '(cmux\s+(wait-for|read-screen|tree|identify|close-surface|new-surface)|~/\.kuma/cmux/)'; then
      echo '{"continue": true}'; exit 0
    fi

    # curl (서버 상태 확인)
    if echo "$cmd" | grep -qE '^\s*curl\s'; then
      echo '{"continue": true}'; exit 0
    fi

    # cat on /tmp/ paths (결과 파일 읽기)
    if echo "$cmd" | grep -qE '^\s*cat\s+/tmp/'; then
      echo '{"continue": true}'; exit 0
    fi

    # rm dispatch lock (정리용)
    if echo "$cmd" | grep -qE '^\s*rm\s+(-f\s+)?/tmp/kuma-dispatch\.lock'; then
      echo '{"continue": true}'; exit 0
    fi

    # nohup/background wrappers for signal watching
    if echo "$cmd" | grep -qE '^\s*nohup\s'; then
      echo '{"continue": true}'; exit 0
    fi

  fi
fi

# === 전부 차단 ===
echo "⚠️ 쿠마는 이 명령 직접 실행 금지. /kuma:dispatch 스킬을 사용해서 서브에이전트로 실행할 것. 직접 Bash는 차단됨." >&2
exit 2
