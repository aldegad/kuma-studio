#!/usr/bin/env bash
# kuma-read-guard.sh — 쿠마 모드에서 코드 직접 읽기 차단
# Read, Grep, Glob 호출 시 실행됨
# 쿠마는 코드를 직접 분석하지 않고 팀에게 위임해야 함

if [ ! -f /tmp/kuma-mode.lock ]; then
  echo '{"continue": true}'
  exit 0
fi

# Workers are spawned with KUMA_ROLE=worker — let them through
if [ "$KUMA_ROLE" = "worker" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Dispatch lock 활성 중 (Agent 서브에이전트 실행 창구) — 10분 time-gate 로 통과
if [ -f /tmp/kuma-dispatch.lock ]; then
  lock_age=$(($(date +%s) - $(stat -f %m /tmp/kuma-dispatch.lock 2>/dev/null || echo "0")))
  if [ "$lock_age" -lt 600 ]; then
    echo '{"continue": true}'
    exit 0
  fi
fi

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // ""')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')
pattern=$(echo "$input" | jq -r '.tool_input.pattern // ""')

# 허용: vault/plans/memory/설정 파일 읽기 (쿠마 부트/운영에 필요)
if [ -n "$file_path" ]; then
  case "$file_path" in
    */.kuma/vault/*|*/.kuma/plans/*|*/.kuma/bin/*|*/.kuma/cmux/*|*/plans/index.md|*/plans/*.md)
      echo '{"continue": true}'; exit 0 ;;
    */.claude/settings*|*/.claude/hooks/*|*/.claude/skills/*|*/.claude/channels/*)
      echo '{"continue": true}'; exit 0 ;;
    */.claude/projects/*/memory/*)
      echo '{"continue": true}'; exit 0 ;;
    /tmp/kuma-tasks/*|/tmp/kuma-results/*|/tmp/kuma-signals/*)
      echo '{"continue": true}'; exit 0 ;;
    */CLAUDE.md|*/MEMORY.md)
      echo '{"continue": true}'; exit 0 ;;
    */team.json)
      echo '{"continue": true}'; exit 0 ;;
    *.png|*.jpg|*.jpeg|*.gif|*.webp)
      echo '{"continue": true}'; exit 0 ;;
  esac
fi

# 허용: Glob으로 파일 목록 찾기 (vault/plans/settings 내에서만)
if [ "$tool" = "Glob" ]; then
  case "$file_path" in
    */.kuma/*|*/.claude/*|/tmp/kuma-*)
      echo '{"continue": true}'; exit 0 ;;
  esac
fi

# 그 외: 소스코드 읽기/검색 차단
echo "⚠️ 쿠마는 코드를 직접 읽지 않는다. 대안: 하울 팀에게 '이 파일/패턴 분석해줘' 위임. kuma-task howl \"[분석 요청]\" --project [프로젝트] --trust-worker" >&2
exit 2
