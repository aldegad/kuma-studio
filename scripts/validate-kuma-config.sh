#!/bin/bash
# 심링크 정합성 검증
KUMA_STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
errors=0
skill_roots=(
  "$HOME/.claude/skills:Claude"
  "$HOME/.codex/skills:Codex"
)

matches_repo_file() {
  local expected="$1"
  local actual="$2"

  if [ "$(readlink "$actual" 2>/dev/null || true)" = "$expected" ]; then
    return 0
  fi

  [ -f "$expected" ] || return 1
  [ -f "$actual" ] || return 1
  cmp -s "$expected" "$actual"
}

matches_skill_dir() {
  local expected_dir="$1"
  local actual_dir="$2"

  if [ "$(readlink "$actual_dir" 2>/dev/null || true)" = "$expected_dir" ]; then
    return 0
  fi

  matches_repo_file "$expected_dir/SKILL.md" "$actual_dir/SKILL.md"
}

# 스킬 심링크 확인
required_skill_specs=(
  "kuma-brief:kuma-brief"
  "kuma-cmux-ops:kuma-cmux-ops"
  "kuma-picker:kuma-picker"
  "kuma-recovery:kuma-recovery"
  "kuma-overnight:kuma-overnight"
  "kuma-panel:kuma-panel"
  "kuma-server:kuma-server"
  "kuma-snapshot:kuma-snapshot"
  "kuma-vault:kuma-vault"
  "noeuri:noeuri"
)
retired_skill_ids=(
  "analytics-team"
  "dev-team"
  "overnight-mode"
  "overnight-off"
  "overnight-on"
  "strategy-analytics-team"
  "strategy-team"
  "tmux-ops"
)
for root_spec in "${skill_roots[@]}"; do
  skill_root="${root_spec%%:*}"
  agent_label="${root_spec#*:}"
  for spec in "${required_skill_specs[@]}"; do
    skill="${spec%%:*}"
    source_skill="${spec#*:}"
    link="$skill_root/$skill"
    target="$KUMA_STUDIO/skills/$source_skill"
    if ! matches_skill_dir "$target" "$link"; then
      echo "❌ $agent_label skill/$skill: 심링크 불일치"
      errors=$((errors + 1))
    fi
  done

  for skill in "${retired_skill_ids[@]}"; do
    link="$skill_root/$skill"
    if [ -e "$link" ] || [ -L "$link" ]; then
      echo "❌ $agent_label skill/$skill: retired skill link remains"
      errors=$((errors + 1))
    fi
  done
done

# 훅 심링크 확인
for hook in "$KUMA_STUDIO"/scripts/hooks/*.sh; do
  name=$(basename "$hook")
  link="$HOME/.claude/hooks/$name"
  if ! matches_repo_file "$hook" "$link"; then
    echo "❌ hooks/$name: 심링크 불일치"
    errors=$((errors + 1))
  fi
done

# cmux 심링크 확인
for script in "$KUMA_STUDIO"/scripts/cmux/*.sh; do
  name=$(basename "$script")
  link="$HOME/.kuma/cmux/$name"
  if ! matches_repo_file "$script" "$link"; then
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
  echo "⚠️ $errors개 불일치 발견. scripts/kuma-setup.sh 또는 node scripts/install.mjs 재실행 필요."
fi
exit $errors
