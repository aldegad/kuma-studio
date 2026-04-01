#!/bin/bash
# =============================================================================
# post-deploy-verify.sh
# 
# Claude Code PostToolUse 훅: 배포 명령 실행 후 쿠마피커 브라우저 검증 알림
#
# 배포 명령(firebase deploy, gcloud run deploy, gcloud deploy)이 감지되면
# 쿠마피커 브라우저 브릿지를 통한 검증을 안내하는 메시지를 출력합니다.
#
# ─────────────────────────────────────────────────────────────────────────────
# 등록 방법 (.claude/settings.json 또는 .claude/settings.local.json):
#
#   {
#     "hooks": {
#       "PostToolUse": [
#         {
#           "matcher": "Bash",
#           "hooks": [
#             {
#               "type": "command",
#               "command": "bash packages/server/scripts/post-deploy-verify.sh"
#             }
#           ]
#         }
#       ]
#     }
#   }
#
# settings.local.json에 넣으면 git에 커밋되지 않아 개인 설정으로 유지 가능.
# =============================================================================

# stdin에서 PostToolUse JSON을 읽음
input=$(cat)

# tool_input.command 필드를 추출 (jq가 없을 경우 grep/sed 폴백)
if command -v jq &>/dev/null; then
  tool_command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  # jq 없을 때 간이 파싱
  tool_command=$(echo "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//;s/"$//')
fi

# 배포 명령 패턴 매칭
if echo "$tool_command" | grep -qE '(firebase deploy|gcloud run deploy|gcloud deploy)'; then
  cat << 'EOF'
{"systemMessage":"⚠️ 배포 완료! 쿠마피커로 브라우저 검증을 해주세요. get-browser-session → browser-navigate → screenshot 순서로 확인하세요.","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"배포가 완료되었습니다. 반드시 쿠마피커 브라우저 브릿지를 통해 배포된 페이지를 확인하세요. 1) get-browser-session으로 브라우저 연결 확인 2) 해당 URL로 navigate 3) 스크린샷으로 검증"}}
EOF
else
  echo '{}'
fi
