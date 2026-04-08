#!/bin/bash
# kuma 모드 아니면 통과
if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

# Kuma CTO Bash guard — 최소 위임 통로만 허용
# 쿠마가 직접 할 수 있는 것: 쭈니/워커에게 전달 + 결과 확인
# 나머지 전부 차단

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# 공용 규칙: cmux browser 명령 실행은 누구든 차단
# 주의: cmux send 안의 메시지 텍스트에 "cmux browser"가 포함된 경우는 통과시켜야 함
if echo "$cmd" | grep -qE '^\s*cmux\s+browser'; then
  echo "⚠️ cmux browser 사용 금지. 대안: 워커에게 Playwright headless 스크린샷 위임. 예: ~/.kuma/cmux/kuma-cmux-send-tui.sh surface:N \"npx playwright screenshot --headless URL /tmp/output.png\". 즉시 대안을 실행할 것."
  exit 2
fi

# Workers are spawned with KUMA_ROLE=worker — let them through (cmux browser 제외)
if [ "$KUMA_ROLE" = "worker" ]; then
  echo '{"continue": true}'
  exit 0
fi

# 허용: cmux send / send-key (워커에게 태스크 전달)
# 허용: cmux wait-for (시그널 대기)
# 허용: cmux read-screen (결과 확인)
# 허용: cmux tree / identify (상태 조회)
# 허용: ~/.kuma/cmux/ 스크립트 (스폰/레지스트리 관리)
if echo "$cmd" | grep -qE '(cmux (send|send-key|wait-for|read-screen|tree|identify|close-surface|new-surface)|~/.kuma/cmux/)'; then
  echo '{"continue": true}'
  exit 0
fi

# 허용: curl (서버 상태 확인용)
if echo "$cmd" | grep -qE '^\s*curl '; then
  echo '{"continue": true}'
  exit 0
fi

# 허용: lsof / pgrep / ps (프로세스 상태 확인 — 읽기 전용)
if echo "$cmd" | grep -qE '^\s*(lsof|pgrep|ps) '; then
  echo '{"continue": true}'
  exit 0
fi

# 허용: cat / ls / echo (읽기 전용 조회)
if echo "$cmd" | grep -qE '^\s*(cat|ls|echo) '; then
  echo '{"continue": true}'
  exit 0
fi

# 그 외 전부 차단 — exit 2 (warn): 차단하되 Claude가 죽지 않고 대안 실행 가능
echo "⚠️ 쿠마는 이 명령 직접 실행 금지. 대안: git/kill/chmod → cmux send로 쭈니(surface:2)에게 위임. node/npm → cmux send로 워커에게 위임. 코드 수정 → Read/Edit 도구 또는 워커 위임. 즉시 대안을 실행할 것."
exit 2
