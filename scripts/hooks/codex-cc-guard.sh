#!/usr/bin/env bash
# Codex Co-Authored-By guard hook for Claude Code PreToolUse:Bash
# git commit에 Claude CC가 있으면 Codex CC도 항상 같이 넣어야 함.

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# git commit이 아니면 통과
if ! echo "$cmd" | grep -q 'git commit'; then
  echo '{"continue": true}'
  exit 0
fi

# Claude CC가 없으면 통과 (Codex CC만 강제할 이유 없음)
if ! echo "$cmd" | grep -qiE 'Co-Authored-By.*Claude'; then
  echo '{"continue": true}'
  exit 0
fi

# Claude CC 있는데 Codex CC 없으면 차단
if ! echo "$cmd" | grep -qiE 'Co-Authored-By.*Codex'; then
  echo "⚠️ CC Claude 있으면 CC Codex도 같이 넣을 것. Co-Authored-By: Codex <noreply@openai.com>" >&2
  exit 2
fi

echo '{"continue": true}'
exit 0
