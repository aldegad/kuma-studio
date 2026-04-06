#!/bin/bash
# Usage: kuma-cmux-spawn.sh <name> <type> [dir] [project] [--direction <dir>] [--surface <ref>] [--workspace <ref>]
# type: claude | codex
# Returns: surface ID
set -euo pipefail

NAME="${1:?name required}"
TYPE="${2:?type required (claude|codex)}"
DIR="${3:-$(pwd)}"
PROJECT="${4:-}"
shift 4 2>/dev/null || true

# Parse optional flags
DIRECTION="right"
TARGET_SURFACE=""
TARGET_WORKSPACE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --direction) DIRECTION="$2"; shift 2 ;;
    --surface) TARGET_SURFACE="$2"; shift 2 ;;
    --workspace) TARGET_WORKSPACE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Create new split pane
SPLIT_ARGS=("$DIRECTION")
if [ -n "$TARGET_WORKSPACE" ]; then
  SPLIT_ARGS+=(--workspace "$TARGET_WORKSPACE")
fi
if [ -n "$TARGET_SURFACE" ]; then
  SPLIT_ARGS+=(--surface "$TARGET_SURFACE")
fi

RESULT=$(cmux new-split "${SPLIT_ARGS[@]}" 2>&1)
SURFACE=$(echo "$RESULT" | grep -oE 'surface:[0-9]+')
WORKSPACE=$(echo "$RESULT" | grep -oE 'workspace:[0-9]+')

if [ -z "$SURFACE" ]; then
  echo "ERROR: Failed to create pane — $RESULT" >&2
  exit 1
fi

sleep 1

# Build send args — cross-workspace
SEND_ARGS=()
if [ -n "$WORKSPACE" ]; then
  SEND_ARGS+=(--workspace "$WORKSPACE")
fi
SEND_ARGS+=(--surface "$SURFACE")

case "$TYPE" in
  claude)
    cmux send "${SEND_ARGS[@]}" "cd \"$DIR\" && KUMA_ROLE=worker claude --dangerously-skip-permissions" > /dev/null
    cmux send-key "${SEND_ARGS[@]}" Enter > /dev/null
    ;;
  sonnet)
    cmux send "${SEND_ARGS[@]}" "cd \"$DIR\" && KUMA_ROLE=worker claude --model sonnet --dangerously-skip-permissions" > /dev/null
    cmux send-key "${SEND_ARGS[@]}" Enter > /dev/null
    ;;
  codex)
    cmux send "${SEND_ARGS[@]}" "cd \"$DIR\" && KUMA_ROLE=worker codex --dangerously-bypass-approvals-and-sandbox -m gpt-5.4 -c service_tier=fast" > /dev/null
    cmux send-key "${SEND_ARGS[@]}" Enter > /dev/null
    ;;
  *)
    echo "ERROR: Unknown type '$TYPE'" >&2
    exit 1
    ;;
esac

# Tab title (이모지+이름)
cmux tab-action --action rename --surface "$SURFACE" --title "$NAME" > /dev/null 2>&1 || true

# Register
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$PROJECT" ]; then
  "$SCRIPT_DIR/kuma-cmux-register.sh" "$PROJECT" "$NAME" "$SURFACE" || true
fi

# Notify studio
curl -sf -X POST "http://127.0.0.1:4312/studio/agent-state" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$NAME\",\"state\":\"idle\",\"surface\":\"$SURFACE\",\"type\":\"$TYPE\",\"project\":\"$PROJECT\"}" \
  > /dev/null 2>&1 || true

echo "$SURFACE"
