#!/bin/bash
# 프로젝트별 surface 레지스트리 현황 출력
# 사용: kuma-cmux-project-status.sh [project-name]
set -euo pipefail

REGISTRY="/tmp/kuma-surfaces.json"

if [ ! -f "$REGISTRY" ]; then
  echo "{}" > "$REGISTRY"
fi

if [ -n "${1:-}" ]; then
  # 특정 프로젝트만
  jq -r --arg p "$1" '.[$p] // empty' "$REGISTRY"
else
  # 전체
  jq '.' "$REGISTRY"
fi
