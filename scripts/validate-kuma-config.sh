#!/bin/bash
# 심링크 정합성 검증
KUMA_STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
errors=0

# 스킬 심링크 확인
for skill in kuma dev-team analytics-team strategy-team tmux-ops; do
  link="$HOME/.claude/skills/$skill"
  target="$KUMA_STUDIO/.claude/skills/$skill"
  if [ "$(readlink "$link" 2>/dev/null)" != "$target" ]; then
    echo "❌ skill/$skill: 심링크 불일치"
    errors=$((errors + 1))
  fi
done

# 훅 심링크 확인
for hook in "$KUMA_STUDIO"/scripts/hooks/*.sh; do
  name=$(basename "$hook")
  link="$HOME/.claude/hooks/$name"
  if [ "$(readlink "$link" 2>/dev/null)" != "$hook" ]; then
    echo "❌ hooks/$name: 심링크 불일치"
    errors=$((errors + 1))
  fi
done

# cmux 심링크 확인
for script in "$KUMA_STUDIO"/scripts/cmux/*.sh; do
  name=$(basename "$script")
  link="$HOME/.kuma/cmux/$name"
  if [ "$(readlink "$link" 2>/dev/null)" != "$script" ]; then
    echo "❌ cmux/$name: 심링크 불일치"
    errors=$((errors + 1))
  fi
done

if [ $errors -eq 0 ]; then
  echo "✅ 모든 심링크 정상"
else
  echo "⚠️ $errors개 불일치 발견. scripts/kuma-setup.sh 재실행 필요."
fi
exit $errors
