#!/usr/bin/env bash
#
# discord-context-guard.sh
# PreToolUse 훅: 디스코드 쓰레드별 프로젝트 컨텍스트 혼동 방지
#
# stdin으로 PreToolUse JSON을 받아 chat_id가 현재 프로젝트와 맞는지 검증.
# 맞지 않으면 systemMessage 경고를 stdout으로 출력.
#
# 사용법: echo '{"tool_name":"reply","tool_input":{"chat_id":"..."}}' | ./discord-context-guard.sh
#

# ─── 매핑 테이블 ───────────────────────────────────────────────
# 새 프로젝트 추가 시 아래에 한 줄씩 추가
# 형식: CHAT_ID|프로젝트명|프로젝트_경로 (한 줄에 하나)
THREAD_ENTRIES="
1488473532181643345|쿠마 스튜디오|personal/kuma-studio
1488474039298035884|Example Project|example-org/example-project
"

# ─── 현재 프로젝트 감지 ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_PROJECT_PATH=""
CURRENT_PROJECT_NAME=""
CURRENT_CHAT_ID=""

while IFS='|' read -r cid pname ppath; do
  [ -z "$cid" ] && continue
  case "$SCRIPT_DIR" in
    *"$ppath"*)
      CURRENT_PROJECT_PATH="$ppath"
      CURRENT_PROJECT_NAME="$pname"
      CURRENT_CHAT_ID="$cid"
      break
      ;;
  esac
done <<< "$THREAD_ENTRIES"

# 현재 프로젝트를 식별할 수 없으면 조용히 종료
if [ -z "$CURRENT_PROJECT_PATH" ]; then
  exit 0
fi

# ─── stdin에서 PreToolUse JSON 읽기 ───────────────────────────
INPUT=$(cat)

# tool_name과 chat_id를 한번에 추출
PARSED=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tool_name = data.get('tool_name', '')
    chat_id = data.get('tool_input', {}).get('chat_id', '')
    print(f'{tool_name}\n{chat_id}')
except:
    print('\n')
" 2>/dev/null)

TOOL_NAME=$(echo "$PARSED" | head -n1)
CHAT_ID=$(echo "$PARSED" | tail -n1)

# reply, react, edit_message, send_message만 검사
case "$TOOL_NAME" in
  reply|react|edit_message|send_message) ;;
  *) exit 0 ;;
esac

# chat_id가 비어있으면 통과
[ -z "$CHAT_ID" ] && exit 0

# ─── 컨텍스트 검증 ─────────────────────────────────────────────
# 현재 프로젝트의 chat_id와 일치하면 통과
if [ "$CHAT_ID" = "$CURRENT_CHAT_ID" ]; then
  exit 0
fi

# 매핑에 존재하는 chat_id인지 확인 → 다른 프로젝트 쓰레드면 경고
while IFS='|' read -r cid pname ppath; do
  [ -z "$cid" ] && continue
  if [ "$CHAT_ID" = "$cid" ]; then
    echo "{\"systemMessage\": \"⚠️ 이 디스코드 쓰레드(chat_id: ${CHAT_ID})는 ${pname} 전용입니다. 현재 작업 컨텍스트(${CURRENT_PROJECT_NAME})와 맞는지 확인하세요.\"}"
    exit 0
  fi
done <<< "$THREAD_ENTRIES"

# 매핑에 없는 chat_id는 통과 (알 수 없는 쓰레드)
exit 0
