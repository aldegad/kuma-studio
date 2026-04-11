#!/bin/bash
# 프로젝트에 surface 등록
# 사용: kuma-cmux-register.sh <project> <role> <surface-id>
set -euo pipefail

SCRIPT_PATH="$(node -e 'const fs = require("node:fs"); const input = process.argv[1]; try { process.stdout.write(fs.realpathSync(input)); } catch { process.stdout.write(input); }' "$0")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

find_kuma_repo_root() {
  local dir="$SCRIPT_DIR"

  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && [ -f "$dir/packages/shared/surface-registry-cli.mjs" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

PROJECT="${1:?project name required}"
ROLE="${2:?role required}"
SURFACE="${3:?surface id required}"
REGISTRY="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
KUMA_REPO_ROOT="${KUMA_REPO_ROOT:-$(find_kuma_repo_root || pwd)}"
KUMA_SURFACE_REGISTRY_CLI="${KUMA_SURFACE_REGISTRY_CLI:-$KUMA_REPO_ROOT/packages/shared/surface-registry-cli.mjs}"

node "$KUMA_SURFACE_REGISTRY_CLI" upsert-label-surface "$REGISTRY" "$PROJECT" "$ROLE" "$SURFACE" > /dev/null
