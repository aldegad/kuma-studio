#!/usr/bin/env bash
# Codex Co-Authored-By guard hook for Claude Code PreToolUse:Bash
# Blocks git commit if Claude CC exists but Codex CC is missing.
# Install: symlink to ~/.claude/hooks/ and reference from settings.json

jq -r '
  if (.tool_input.command | test("git commit"))
     and (.tool_input.command | test("Co-Authored-By.*Claude"; "i"))
     and (.tool_input.command | test("Co-Authored-By.*Codex"; "i") | not)
  then
    "{\"continue\":false,\"stopReason\":\"Codex Co-Authored-By 누락! Codex 워커 참여 시 Co-Authored-By: Codex <noreply@openai.com> 추가 필요.\"}"
  else
    "{\"continue\":true}"
  end
'
