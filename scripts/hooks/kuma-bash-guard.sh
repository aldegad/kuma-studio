#!/bin/bash
# kuma-bash-guard v3 — 역할 분리 + early-return 구조
# 쿠마 모드에서 Bash 직접 호출을 원칙적으로 금지
# 워커/메인 dispatch는 trusted kuma-task / kuma-dispatch wrapper를 통해 실행

# 쿠마 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
agent_id=$(echo "$input" | jq -r '.agent_id // ""')

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

# Claude Code subagents include agent_id on PreToolUse — let them through
if [ -n "$agent_id" ]; then
  echo '{"continue": true}'
  exit 0
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

if echo "$cmd" | grep -qE '(^|\s)(bash\s+)?(~\/\.kuma\/cmux\/)?kuma-cmux-send\.sh(\s|$)'; then
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

# --- 전부 차단 ---
echo "⚠️ 쿠마는 이 명령 직접 실행 금지. trusted wrapper(~/.kuma/bin/kuma-task 또는 ~/.kuma/bin/kuma-dispatch)를 사용할 것. 직접 Bash는 차단됨." >&2
exit 2
