#!/bin/bash
set -euo pipefail

# /kuma 모드 부트스트랩 — clone 후 1회 실행
KUMA_STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
echo "🐻 쿠마 스튜디오 설정: $KUMA_STUDIO"

# 1. 스킬 심링크
mkdir -p ~/.claude/skills
skill_specs=(
  "kuma:kuma"
  "dev-team:dev-team"
  "strategy-analytics-team:analytics-team"
  "analytics-team:analytics-team"
  "strategy-team:strategy-team"
  "tmux-ops:tmux-ops"
)
for spec in "${skill_specs[@]}"; do
  skill="${spec%%:*}"
  source_skill="${spec#*:}"
  target="$KUMA_STUDIO/.claude/skills/$source_skill"
  link="$HOME/.claude/skills/$skill"
  [ -L "$link" ] && rm "$link"
  ln -sf "$target" "$link"
  echo "  ✓ skill: $skill"
done

# 2. 훅 심링크
mkdir -p ~/.claude/hooks
for hook in "$KUMA_STUDIO"/scripts/hooks/*.sh; do
  name=$(basename "$hook")
  link="$HOME/.claude/hooks/$name"
  [ -L "$link" ] && rm "$link"
  ln -sf "$hook" "$link"
  echo "  ✓ hook: $name"
done

# 3. cmux 스크립트 심링크
mkdir -p ~/.kuma/cmux
for script in "$KUMA_STUDIO"/scripts/cmux/*.sh; do
  name=$(basename "$script")
  link="$HOME/.kuma/cmux/$name"
  [ -L "$link" ] && rm "$link"
  ln -sf "$script" "$link"
  echo "  ✓ cmux: $name"
done

for link in "$HOME"/.kuma/cmux/*.sh; do
  [ -e "$link" ] || [ -L "$link" ] || continue
  target="$(readlink "$link" 2>/dev/null || true)"
  case "$target" in
    "$KUMA_STUDIO"/cmux/*)
      rm -f "$link"
      echo "  ✓ cmux cleanup: $(basename "$link")"
      ;;
    "$KUMA_STUDIO"/scripts/cmux/*)
      if [ ! -f "$target" ]; then
        rm -f "$link"
        echo "  ✓ cmux cleanup: $(basename "$link")"
      fi
      ;;
  esac
done

# 4. 프로젝트 맵 (없으면 복사, 있으면 스킵)
mkdir -p ~/.kuma
if [ ! -f ~/.kuma/projects.json ]; then
  cp "$KUMA_STUDIO/config/projects.json" ~/.kuma/projects.json
  echo "  ✓ config: projects.json (새로 생성)"
else
  echo "  ⊘ config: projects.json (기존 유지)"
fi

# 5. 플랜 디렉토리
mkdir -p ~/.kuma/plans

echo ""
echo "✅ 설정 완료. /kuma 스킬로 쿠마 모드를 활성화하세요."
