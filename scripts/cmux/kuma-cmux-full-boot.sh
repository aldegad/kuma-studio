#!/bin/bash
# Usage: kuma-cmux-full-boot.sh [project]
# Default: kuma-studio only. Pass project name to boot specific one.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS_MAP="$HOME/.kuma/projects.json"
REGISTRY="/tmp/kuma-surfaces.json"
REPORT="/tmp/kuma-boot-report.md"
TEAM_EXPECTED=11

if [ ! -f "$REGISTRY" ]; then
  echo "{}" > "$REGISTRY"
fi

# 대상 프로젝트 결정
TARGET="${1:-kuma-studio}"

DIR=$(jq -r --arg p "$TARGET" '.[$p] // empty' "$PROJECTS_MAP" 2>/dev/null)
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
  echo "ERROR: $TARGET — 디렉토리 없음" >&2
  exit 1
fi

# 스폰
INIT_OUTPUT=$("$SCRIPT_DIR/kuma-cmux-project-init.sh" "$TARGET" "$DIR" 2>&1) || true
echo "$INIT_OUTPUT"

# 리포트 생성
TEAM_OK=$(jq -r --arg p "$TARGET" '.[$p] // {} | length' "$REGISTRY" 2>/dev/null || echo "0")

> "$REPORT"
echo "# 쿠마 스튜디오 부트 리포트" >> "$REPORT"
echo "" >> "$REPORT"
echo "## $TARGET" >> "$REPORT"

if [ "$TEAM_OK" -ge "$TEAM_EXPECTED" ]; then
  echo "- 상태: ✅ 전원 레디 ($TEAM_OK/$TEAM_EXPECTED)" >> "$REPORT"
elif [ "$TEAM_OK" -gt 0 ]; then
  echo "- 상태: ⚠️ 부분 레디 ($TEAM_OK/$TEAM_EXPECTED)" >> "$REPORT"
else
  echo "- 상태: ❌ 스폰 실패" >> "$REPORT"
fi

jq -r --arg p "$TARGET" '.[$p] // {} | to_entries[] | "- \(.key): \(.value)"' "$REGISTRY" 2>/dev/null >> "$REPORT" || true

cat "$REPORT"
