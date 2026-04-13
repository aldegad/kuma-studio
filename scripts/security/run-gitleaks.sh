#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_PATH="${KUMA_GITLEAKS_CONFIG:-$REPO_ROOT/.gitleaks.toml}"
IMAGE="${KUMA_GITLEAKS_IMAGE:-ghcr.io/gitleaks/gitleaks:latest}"

# Scanner wrapper used by both manual scripts and the pre-commit hook.
# Preference order is:
# 1. local gitleaks binary
# 2. Docker image if the daemon is available
# This keeps commits protected even when Docker is installed but not running.

MODE="repo"
if [ $# -gt 0 ]; then
  case "$1" in
    --repo)
      MODE="repo"
      shift
      ;;
    --staged)
      MODE="staged"
      shift
      ;;
    *)
      printf 'Usage: %s [--repo|--staged]\n' "$0" >&2
      exit 64
      ;;
  esac
fi

cd "$REPO_ROOT"

LOCAL_ARGS=(git --no-banner --redact --verbose --config "$CONFIG_PATH")
DOCKER_ARGS=(git --no-banner --redact --verbose --config /repo/.gitleaks.toml)

if [ "$MODE" = "staged" ]; then
  LOCAL_ARGS+=(--pre-commit --staged)
  DOCKER_ARGS+=(--pre-commit --staged)
fi

LOCAL_ARGS+=("$REPO_ROOT")
DOCKER_ARGS+=(/repo)

if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks "${LOCAL_ARGS[@]}"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  exec docker run --rm -v "$REPO_ROOT:/repo" -w /repo "$IMAGE" "${DOCKER_ARGS[@]}"
fi

cat >&2 <<EOF
ERROR: gitleaks is not available for this repository hook.

Choose one:
1. Install locally: brew install gitleaks
2. Or start Docker Desktop so the hook can use: $IMAGE

The commit is blocked until one of those scanners is available.
EOF
exit 1
