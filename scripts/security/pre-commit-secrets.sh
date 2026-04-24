#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Policy layer before gitleaks runs.
# Why this exists:
# - gitleaks is good at generic secrets, but it does not know Kuma-specific
#   privacy boundaries like vault/memory/runtime artifacts.
# - This hook blocks those paths and private project identifiers before the
#   generic secret scan runs, so accidental staging fails fast and clearly.
# - Structure docs remain allowed; this only blocks actual runtime-data roots
#   and protected private identifiers.

cd "$REPO_ROOT"

STAGED_FILES=()
while IFS= read -r line; do
  STAGED_FILES+=("$line")
done < <(git diff --cached --name-only --diff-filter=ACMR)

if [ "${#STAGED_FILES[@]}" -eq 0 ]; then
  exit 0
fi

protected_identifier_regex() {
  REPO_ROOT="$REPO_ROOT" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const staticIds = ["bl" + "ock-s", "bl" + "ock_s", "g" + "sil"];
const projectsPath = process.env.KUMA_PROJECTS_PATH
  || path.join(process.env.HOME || "", ".kuma", "projects.json");
const repoRoot = fs.realpathSync.native(process.env.REPO_ROOT);
const repoLeaf = path.basename(repoRoot).toLowerCase();
const publicIds = new Set([repoLeaf, "kuma-studio", "kuma-studio-private"]);
const identifiers = new Set(staticIds);

function addIdentifier(value) {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (normalized.length < 4) return;
  if (publicIds.has(normalized.toLowerCase())) return;
  identifiers.add(normalized);
}

function addRootSegments(value) {
  if (typeof value !== "string" || !value.trim()) return;
  const normalizedRoot = path.resolve(value);
  if (normalizedRoot === repoRoot || normalizedRoot.startsWith(`${repoRoot}${path.sep}`)) {
    return;
  }
  addIdentifier(path.basename(normalizedRoot));
}

function visitProjectEntry(key, value) {
  addIdentifier(key);
  if (typeof value === "string") {
    addRootSegments(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  addIdentifier(value.projectId);
  addIdentifier(value.id);
  addIdentifier(value.slug);
  addRootSegments(value.root);
  addRootSegments(value.path);
  addRootSegments(value.workspace);
}

if (fs.existsSync(projectsPath)) {
  const parsed = JSON.parse(fs.readFileSync(projectsPath, "utf8"));
  if (Array.isArray(parsed)) {
    parsed.forEach((value, index) => visitProjectEntry(String(index), value));
  } else if (parsed && typeof parsed === "object") {
    const projects = parsed.projects;
    if (Array.isArray(projects)) {
      projects.forEach((value, index) => visitProjectEntry(String(index), value));
    } else if (projects && typeof projects === "object") {
      Object.entries(projects).forEach(([key, value]) => visitProjectEntry(key, value));
    }
    Object.entries(parsed).forEach(([key, value]) => {
      if (key === "projects") return;
      if (value && typeof value === "object") {
        visitProjectEntry(key, value);
      } else if (typeof value === "string" && value.includes(path.sep)) {
        visitProjectEntry(key, value);
      }
    });
  }
}

function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

process.stdout.write(Array.from(identifiers).map(escapeRegex).join("|"));
NODE
}

if ! PROTECTED_IDENTIFIER_REGEX="$(protected_identifier_regex)"; then
  printf 'Blocked commit: could not resolve private-project identifier policy from local project registry.\n' >&2
  exit 1
fi

protected_identifier_path_regex() {
  printf '(^|[^[:alnum:]])(%s)([^[:alnum:]]|$)' "$PROTECTED_IDENTIFIER_REGEX"
}

protected_identifier_content_regex() {
  printf '(^|[^[:alnum:]_])(%s)([^[:alnum:]_]|$)' "$PROTECTED_IDENTIFIER_REGEX"
}

is_blocked_path() {
  local path="${1:?path required}"

  # Machine-local Kuma runtime state must never be published from this repo.
  if [[ "$path" =~ (^|/)\.kuma(/|$) ]]; then
    return 0
  fi

  if [[ "$path" =~ (^|/)\.kuma-picker(/|$) ]]; then
    return 0
  fi

  if [[ "$path" =~ (^|/)\.kuma-studio(/|$) ]]; then
    return 0
  fi

  if [[ "$path" =~ (^|/)\.claude/projects(/|$) ]]; then
    return 0
  fi

  # A nested private clone inside the public repo is always a mistake.
  if [[ "$path" =~ (^|/)kuma-studio-private(/|$) ]]; then
    return 0
  fi

  # Top-level knowledge roots are treated as private content, not public docs.
  if [[ "$path" =~ ^(vault|memory|memo)/ ]]; then
    return 0
  fi

  # Task/result handoff files often contain private prompts, outputs, or paths.
  if [[ "$path" =~ (^|/)[^/]+\.(task|result)\.md$ ]]; then
    return 0
  fi

  # Protected private project identifiers should not appear in committed paths.
  if [[ "$path" =~ $(protected_identifier_path_regex) ]]; then
    return 0
  fi

  return 1
}

is_policy_definition_path() {
  local path="${1:?path required}"

  case "$path" in
    .githooks/pre-commit|.gitleaks.toml|scripts/security/*)
      return 0
      ;;
  esac

  return 1
}

BLOCKED_PATHS=()
for path in "${STAGED_FILES[@]}"; do
  if is_blocked_path "$path"; then
    BLOCKED_PATHS+=("$path")
  fi
done

if [ "${#BLOCKED_PATHS[@]}" -gt 0 ]; then
  printf 'Blocked commit: staged paths match protected Kuma/private patterns.\n' >&2
  printf 'Unstage these paths before committing:\n' >&2
  for path in "${BLOCKED_PATHS[@]}"; do
    printf '  - %s\n' "$path" >&2
  done
  exit 1
fi

ADDED_LINES="$(
  for path in "${STAGED_FILES[@]}"; do
    if is_policy_definition_path "$path"; then
      continue
    fi
    git diff --cached --no-color --no-ext-diff --unified=0 --diff-filter=ACMR -- "$path"
  done | awk '
    /^\+\+\+ b\// { next }
    /^\+/ { print substr($0, 2) }
  '
)"

# Also block private identifiers when they appear inside otherwise-valid files.
if printf '%s\n' "$ADDED_LINES" | grep -Eiq "$(protected_identifier_content_regex)"; then
  printf 'Blocked commit: added lines contain protected private-project identifiers.\n' >&2
  printf 'Remove or redact those references before committing.\n' >&2
  exit 1
fi

exec "$REPO_ROOT/scripts/security/run-gitleaks.sh" --staged
