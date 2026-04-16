#!/usr/bin/env bash
# Co-Authored-By guard hook for Claude Code PreToolUse:Bash
# git commit 메시지에 Claude 또는 Codex co-author 를 넣는 것을 금지.

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# git commit이 아니면 통과
if ! echo "$cmd" | grep -q 'git commit'; then
  echo '{"continue": true}'
  exit 0
fi

# Claude 또는 Codex Co-Authored-By 가 있으면 차단
if echo "$cmd" | grep -qiE 'Co-Authored-By.*(Claude|Codex)'; then
  echo "⚠️ Co-Authored-By 에 Claude / Codex 금지. 해당 줄을 빼고 다시 커밋." >&2
  exit 2
fi

echo '{"continue": true}'
exit 0
