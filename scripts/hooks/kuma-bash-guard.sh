#!/bin/bash
# kuma-bash-guard v3 — 역할 분리 + early-return 구조
# 쿠마 모드에서 Bash 직접 호출을 원칙적으로 금지
# 워커 작업은 /kuma:dispatch 스킬 → 서브에이전트를 통해서만 실행

# 쿠마 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# cmux browser는 누구든 차단 — 쿠마피커 사용할 것
if echo "$cmd" | grep -qE '^\s*cmux\s+browser'; then
  echo "⚠️ cmux browser 사용 금지. 쿠마피커(kuma-picker)로 스크린샷/QA 수행할 것. Playwright는 쿠마피커 기능 개선 테스트 전용 — 직접 QA 용도 금지." >&2
  exit 2
fi

# Workers (KUMA_ROLE=worker) — cmux browser 외 전부 통과
if [ "$KUMA_ROLE" = "worker" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Dispatch lock 활성 중 (Agent 서브에이전트 실행 창구) — cmux browser 외 통과
# kuma-agent-guard 와 동일한 10분 time-gate 적용
if [ -f /tmp/kuma-dispatch.lock ]; then
  lock_age=$(($(date +%s) - $(stat -f %m /tmp/kuma-dispatch.lock 2>/dev/null || echo "0")))
  if [ "$lock_age" -lt 600 ]; then
    echo '{"continue": true}'
    exit 0
  fi
fi

# ============================================================
# 이하 쿠마 메인 스레드 전용 규칙
# 원칙: 스킬 + Discord 외에는 아무것도 못 함
# 구조: 허용 패턴을 먼저 통과시키고, 나머지는 전부 차단
# ============================================================

# --- 항상 허용: 신뢰된 래퍼 ---
if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~/\.kuma/bin/)?kuma-(task|dispatch)(\s|$)'; then
  echo '{"continue": true}'; exit 0
fi

# --- 항상 허용: 읽기전용 즉시 완료 명령 ---

# kuma-status / kuma-kill / kuma-spawn-all / kuma-restart-all
if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~/\.kuma/bin/)?kuma-(status|kill|kill-all|spawn-all|restart-all)(\s|$)'; then
  echo '{"continue": true}'; exit 0
fi

# chmod on ~/.kuma/bin/
if echo "$cmd" | grep -qE '^\s*chmod\s.*~/\.kuma/bin/'; then
  echo '{"continue": true}'; exit 0
fi

# ls: /tmp/kuma-*, ~/.kuma/, ~/.claude/, output/playwright/
if echo "$cmd" | grep -qE '^\s*ls\s+(-[a-zA-Z]+\s+)*(/tmp/kuma-|.*/\.kuma/|.*/\.claude/|.*/output/playwright)'; then
  echo '{"continue": true}'; exit 0
fi

# cmux tree / close-surface
if echo "$cmd" | grep -qE '^\s*cmux\s+(tree|close-surface)(\s|$)'; then
  echo '{"continue": true}'; exit 0
fi

# raw cmux send/send-key는 직접 호출 금지
if echo "$cmd" | grep -qE '^\s*cmux\s+(send|send-key)(\s|$)'; then
  echo "⚠️ raw cmux send/send-key 사용 금지. ~/.kuma/cmux/kuma-cmux-send.sh 를 사용할 것." >&2
  exit 2
fi

# --- dispatch lock 유효할 때 추가 허용 (서브에이전트용) ---

dispatch_lock_valid() {
  [ -f /tmp/kuma-dispatch.lock ] || return 1
  local lock_age=$(($(date +%s) - $(stat -f %m /tmp/kuma-dispatch.lock 2>/dev/null || echo "0")))
  [ "$lock_age" -lt 600 ]
}

if dispatch_lock_valid; then
  # kuma CLI 래퍼
  if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~/\.kuma/bin/)?kuma-(task|dispatch|spawn|read|kill|project-init)(\s|$)'; then
    echo '{"continue": true}'; exit 0
  fi

  # cmux 운영 명령
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

  # nohup/background wrappers
  if echo "$cmd" | grep -qE '^\s*nohup\s'; then
    echo '{"continue": true}'; exit 0
  fi
fi

# --- 전부 차단 ---
echo "⚠️ 쿠마는 이 명령 직접 실행 금지. /kuma:dispatch 스킬을 사용해서 서브에이전트로 실행할 것. 직접 Bash는 차단됨." >&2
exit 2
