#!/bin/bash
set -euo pipefail

# /kuma 모드 부트스트랩 — clone 후 1회 실행
KUMA_STUDIO="$(cd "$(dirname "$0")/.." && /bin/pwd -P)"
echo "🐻 쿠마 스튜디오 설정: $KUMA_STUDIO"

# 1. 스킬 심링크
skill_roots=(
  "$HOME/.claude/skills:Claude"
  "$HOME/.codex/skills:Codex"
)
skill_specs=(
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
  mkdir -p "$skill_root"
  for skill in "${retired_skill_ids[@]}"; do
    link="$skill_root/$skill"
    if [ -L "$link" ]; then
      target="$(readlink "$link" 2>/dev/null || true)"
      case "$target" in
        "$KUMA_STUDIO"/skills/*|"$KUMA_STUDIO"/.claude/skills/*)
          rm -f "$link"
          echo "  ✓ $agent_label skill cleanup: $skill"
          ;;
      esac
    fi
  done
  for spec in "${skill_specs[@]}"; do
    skill="${spec%%:*}"
    source_skill="${spec#*:}"
    target="$KUMA_STUDIO/skills/$source_skill"
    if [ ! -f "$target/SKILL.md" ]; then
      echo "  ⚠ $agent_label skill source missing: $source_skill"
      continue
    fi
    link="$skill_root/$skill"
    [ -L "$link" ] && rm "$link"
    ln -snf "$target" "$link"
    echo "  ✓ $agent_label skill: $skill"
  done
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

# 4. ~/.kuma/bin canonical install path 보장
node "$KUMA_STUDIO/scripts/install.mjs" --skip-deps --skip-build
echo "  ✓ bin/install: scripts/install.mjs (--skip-deps --skip-build)"

# 5. 프로젝트 맵 (없으면 복사, 있으면 스킵)
mkdir -p ~/.kuma
if [ ! -f ~/.kuma/projects.json ]; then
  node - "$HOME/.kuma/projects.json" "$KUMA_STUDIO" <<'NODE'
const fs = require("node:fs");
const [, , destPath, studioPath] = process.argv;
fs.writeFileSync(destPath, `${JSON.stringify({ "kuma-studio": studioPath }, null, 2)}\n`);
NODE
  echo "  ✓ config: projects.json (새로 생성)"
else
  echo "  ⊘ config: projects.json (기존 유지)"
fi

# 6. 플랜 디렉토리
mkdir -p ~/.kuma/plans

echo ""
echo "✅ 설정 완료. /kuma 스킬로 쿠마 모드를 활성화하세요."
