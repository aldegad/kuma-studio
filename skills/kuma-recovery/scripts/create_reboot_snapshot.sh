#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STAMP="${1:-$(date +%Y%m%d-%H%M%S)}"
BACKUP_DIR="${KUMA_REBOOT_BACKUP_DIR:-$HOME/.kuma/reboot-backups/$STAMP}"
CLAUDE_PROJECT_DIR="${KUMA_CLAUDE_PROJECT_DIR:-$HOME/.claude/projects/-Users-soohongkim-Documents-workspace-personal-kuma-studio}"

mkdir -p "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR/dispatch-tasks" "$BACKUP_DIR/dispatch-results" "$BACKUP_DIR/vault" "$BACKUP_DIR/claude-projects" "$BACKUP_DIR/codex" "$BACKUP_DIR/repo"

if [ -d "$HOME/.kuma/dispatch/tasks" ]; then
  cp -R "$HOME/.kuma/dispatch/tasks/." "$BACKUP_DIR/dispatch-tasks/" 2>/dev/null || true
fi

if [ -d "$HOME/.kuma/dispatch/results" ]; then
  cp -R "$HOME/.kuma/dispatch/results/." "$BACKUP_DIR/dispatch-results/" 2>/dev/null || true
fi

for file_name in dispatch-log.md log.md decisions.md index.md; do
  if [ -f "$HOME/.kuma/vault/$file_name" ]; then
    cp "$HOME/.kuma/vault/$file_name" "$BACKUP_DIR/vault/$file_name"
  fi
done

if [ -d "$CLAUDE_PROJECT_DIR" ]; then
  ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -40 | while read -r file_path; do
    cp "$file_path" "$BACKUP_DIR/claude-projects/"
  done
fi

for file_path in \
  "$HOME/.codex/history.jsonl" \
  "$HOME/.codex/session_index.jsonl" \
  "$HOME/.codex/.codex-global-state.json" \
  "$HOME/.codex/log/codex-tui.log"
do
  if [ -f "$file_path" ]; then
    cp "$file_path" "$BACKUP_DIR/codex/"
  fi
done

git -C "$ROOT_DIR" status --short > "$BACKUP_DIR/repo/git-status.txt" || true
git -C "$ROOT_DIR" diff > "$BACKUP_DIR/repo/git-diff.patch" || true

{
  echo "backup_dir=$BACKUP_DIR"
  echo "created_at=$(date -Iseconds)"
  echo "repo_root=$ROOT_DIR"
  echo "dispatch_task_count=$(find "$BACKUP_DIR/dispatch-tasks" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "dispatch_result_count=$(find "$BACKUP_DIR/dispatch-results" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "claude_jsonl_count=$(find "$BACKUP_DIR/claude-projects" -type f -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')"
} > "$BACKUP_DIR/manifest.txt"

echo "$BACKUP_DIR"
echo "--- manifest ---"
cat "$BACKUP_DIR/manifest.txt"
