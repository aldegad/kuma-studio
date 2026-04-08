#!/bin/bash
# Usage: kuma-cmux-spawn.sh <name> [type] [dir] [project] [--direction <dir>] [--surface <ref>] [--workspace <ref>] [--pane <ref>]
# type is optional when the member exists in ~/.kuma/team.json
# Returns: surface ID
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/kuma-cmux-team-config.sh"

NAME="${1:?name required}"
TYPE="${2:-}"
DIR="${3:-$(pwd)}"
PROJECT="${4:-}"
shift 4 2>/dev/null || true

NORMALIZED_NAME="$(normalize_member_name "$NAME")"
RESOLVED_TYPE="$TYPE"
if team_config_exists && team_config_member_exists "$NORMALIZED_NAME"; then
  RESOLVED_TYPE="$(team_config_get_member_field "$NORMALIZED_NAME" type)"
fi

# Parse optional flags
DIRECTION="right"
TARGET_SURFACE=""
TARGET_WORKSPACE=""
TARGET_PANE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --direction) DIRECTION="$2"; shift 2 ;;
    --surface) TARGET_SURFACE="$2"; shift 2 ;;
    --workspace) TARGET_WORKSPACE="$2"; shift 2 ;;
    --pane) TARGET_PANE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Create new split pane or tab
if [ -n "$TARGET_PANE" ]; then
  CREATE_ARGS=(--pane "$TARGET_PANE")
  if [ -n "$TARGET_WORKSPACE" ]; then
    CREATE_ARGS+=(--workspace "$TARGET_WORKSPACE")
  fi
  RESULT=$(cmux new-surface "${CREATE_ARGS[@]}" 2>&1)
else
  SPLIT_ARGS=("$DIRECTION")
  if [ -n "$TARGET_WORKSPACE" ]; then
    SPLIT_ARGS+=(--workspace "$TARGET_WORKSPACE")
  fi
  if [ -n "$TARGET_SURFACE" ]; then
    SPLIT_ARGS+=(--surface "$TARGET_SURFACE")
  fi
  RESULT=$(cmux new-split "${SPLIT_ARGS[@]}" 2>&1)
fi

SURFACE=$(echo "$RESULT" | grep -oE 'surface:[0-9]+' | head -1)
WORKSPACE="${TARGET_WORKSPACE:-$(echo "$RESULT" | grep -oE 'workspace:[0-9]+' | head -1)}"

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

COMMAND="$(build_member_command "$NAME" "$TYPE" "$DIR")"
cmux send "${SEND_ARGS[@]}" "$COMMAND" > /dev/null
cmux send-key "${SEND_ARGS[@]}" Enter > /dev/null

# Tab title (이모지+이름)
TITLE="$(member_display_label "$NORMALIZED_NAME")"
cmux tab-action --action rename --surface "$SURFACE" --title "$TITLE" > /dev/null 2>&1 || true

# Register
if [ -n "$PROJECT" ]; then
  "$SCRIPT_DIR/kuma-cmux-register.sh" "$PROJECT" "$TITLE" "$SURFACE" || true
fi

if [ "${KUMA_SKIP_AGENT_STATE_NOTIFY:-0}" != "1" ]; then
  curl -sf -X POST "http://127.0.0.1:4312/studio/agent-state" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$NORMALIZED_NAME\",\"state\":\"idle\",\"surface\":\"$SURFACE\",\"type\":\"${RESOLVED_TYPE:-unknown}\",\"project\":\"$PROJECT\"}" \
    > /dev/null 2>&1 || true
fi

echo "$SURFACE"
