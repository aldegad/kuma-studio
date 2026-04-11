#!/bin/bash
# 심링크 정합성 검증
KUMA_STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
errors=0

# 스킬 심링크 확인
required_skill_specs=(
  "kuma:kuma"
  "dev-team:dev-team"
  "analytics-team:analytics-team"
  "strategy-team:strategy-team"
  "tmux-ops:tmux-ops"
)
for spec in "${required_skill_specs[@]}"; do
  skill="${spec%%:*}"
  source_skill="${spec#*:}"
  link="$HOME/.claude/skills/$skill"
  target="$KUMA_STUDIO/skills/$source_skill"
  if [ "$(readlink "$link" 2>/dev/null)" != "$target" ]; then
    echo "❌ skill/$skill: 심링크 불일치"
    errors=$((errors + 1))
  fi
done

strategy_analytics_link="$HOME/.claude/skills/strategy-analytics-team"
strategy_analytics_target="$KUMA_STUDIO/skills/analytics-team"
if [ -L "$strategy_analytics_link" ]; then
  if [ "$(readlink "$strategy_analytics_link" 2>/dev/null)" != "$strategy_analytics_target" ]; then
    echo "❌ skill/strategy-analytics-team: 심링크 불일치"
    errors=$((errors + 1))
  fi
else
  echo "⚠️ skill/strategy-analytics-team: 미설치 (legacy analytics-team / strategy-team alias 허용)"
fi

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

for link in "$HOME"/.kuma/cmux/*.sh; do
  [ -e "$link" ] || [ -L "$link" ] || continue
  name=$(basename "$link")
  target="$(readlink "$link" 2>/dev/null || true)"
  expected="$KUMA_STUDIO/scripts/cmux/$name"
  legacy="$KUMA_STUDIO/cmux/$name"

  if [ "$target" = "$legacy" ]; then
    echo "❌ cmux/$name: 레거시 repo-root cmux 경로를 가리킴"
    errors=$((errors + 1))
    continue
  fi

  if [ ! -f "$expected" ]; then
    echo "❌ cmux/$name: stale symlink (repo에 해당 스크립트 없음)"
    errors=$((errors + 1))
  fi
done

if [ $errors -eq 0 ]; then
  echo "✅ 모든 심링크 정상"
else
  echo "⚠️ $errors개 불일치 발견. scripts/kuma-setup.sh 재실행 필요."
fi
exit $errors
