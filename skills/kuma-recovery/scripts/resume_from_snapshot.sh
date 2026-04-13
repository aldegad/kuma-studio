#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${KUMA_REBOOT_BACKUP_ROOT:-$HOME/.kuma/reboot-backups}"
KUMA_DISPATCH_BIN="${KUMA_DISPATCH_BIN:-$HOME/.kuma/bin/kuma-dispatch}"
BACKUP_DIR="${1:-}"

if [ -z "$BACKUP_DIR" ]; then
  BACKUP_DIR="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)"
fi

if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
  echo "Backup directory not found." >&2
  exit 1
fi

mkdir -p "$HOME/.kuma/dispatch/tasks" "$HOME/.kuma/dispatch/results"

if [ -d "$BACKUP_DIR/dispatch-tasks" ]; then
  cp -R "$BACKUP_DIR/dispatch-tasks/." "$HOME/.kuma/dispatch/tasks/"
fi

if [ -d "$BACKUP_DIR/dispatch-results" ]; then
  cp -R "$BACKUP_DIR/dispatch-results/." "$HOME/.kuma/dispatch/results/"
fi

echo "backup_dir=$BACKUP_DIR"
if [ -f "$BACKUP_DIR/manifest.txt" ]; then
  echo "--- manifest ---"
  cat "$BACKUP_DIR/manifest.txt"
fi

echo "--- vault summary ---"
for file_name in current-focus.md dispatch-log.md thread-map.md decisions.md; do
  if [ -f "$BACKUP_DIR/vault/$file_name" ]; then
    echo "===== $file_name"
    sed -n '1,40p' "$BACKUP_DIR/vault/$file_name"
  fi
done

echo "--- dispatch status ---"
if [ ! -x "$KUMA_DISPATCH_BIN" ]; then
  echo "kuma-dispatch CLI not found at $KUMA_DISPATCH_BIN" >&2
else
  ls -t "$HOME/.kuma/dispatch/tasks"/*.task.md 2>/dev/null | head -10 | while read -r task_file; do
    echo "===== $task_file"
    "$KUMA_DISPATCH_BIN" status --task-file "$task_file" 2>&1 || true
  done
fi
