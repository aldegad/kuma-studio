#!/bin/bash
# 프로젝트에 surface 등록
# 사용: kuma-cmux-register.sh <project> <role> <surface-id>
set -euo pipefail

PROJECT="${1:?project name required}"
ROLE="${2:?role required}"
SURFACE="${3:?surface id required}"
REGISTRY="/tmp/kuma-surfaces.json"

if [ ! -f "$REGISTRY" ]; then
  echo "{}" > "$REGISTRY"
fi

jq --arg p "$PROJECT" --arg r "$ROLE" --arg s "$SURFACE" \
  '.[$p] = ((.[$p] // {}) | .[$r] = $s)' "$REGISTRY" > "${REGISTRY}.tmp" \
  && mv "${REGISTRY}.tmp" "$REGISTRY"
