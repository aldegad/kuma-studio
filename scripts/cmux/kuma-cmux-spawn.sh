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

LAUNCH_RECORD="$(resolve_member_launch_record "$NAME" "$TYPE")"
IFS=$'\x1f' read -r _RESOLVED_NAME RESOLVED_TYPE _RESOLVED_MODEL _RESOLVED_OPTIONS _RESOLVED_EMOJI <<< "$LAUNCH_RECORD"

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

COMMAND="$(build_member_command_from_record "$DIR" "$LAUNCH_RECORD")"
SEND_SCRIPT_ARGS=("$SURFACE" "$COMMAND")
if [ -n "$WORKSPACE" ]; then
  SEND_SCRIPT_ARGS+=(--workspace "$WORKSPACE")
fi
"$SCRIPT_DIR/kuma-cmux-send.sh" "${SEND_SCRIPT_ARGS[@]}" > /dev/null

# Tab title (이모지+이름)
TITLE="$(member_display_label "$NORMALIZED_NAME" "$LAUNCH_RECORD")"
RENAME_ARGS=(--action rename --surface "$SURFACE" --title "$TITLE")
if [ -n "$WORKSPACE" ]; then
  RENAME_ARGS=(--action rename --workspace "$WORKSPACE" --surface "$SURFACE" --title "$TITLE")
fi
if ! cmux tab-action "${RENAME_ARGS[@]}" > /dev/null 2>&1; then
  echo "TITLE_RENAME_FAILED: member=$NAME surface=$SURFACE workspace=${WORKSPACE:-unknown}" >&2
fi

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
