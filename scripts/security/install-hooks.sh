#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# One-time per-clone setup:
# point git at the repo-local hook directory so the guardrails travel with the
# repository instead of living as undocumented local-only hooks.

chmod +x \
  "$REPO_ROOT/.githooks/pre-commit" \
  "$REPO_ROOT/scripts/security/pre-commit-secrets.sh" \
  "$REPO_ROOT/scripts/security/run-gitleaks.sh"

git -C "$REPO_ROOT" config core.hooksPath .githooks

printf 'Installed repo-local git hooks at %s/.githooks\n' "$REPO_ROOT"
printf 'Current core.hooksPath: %s\n' "$(git -C "$REPO_ROOT" config --get core.hooksPath)"
