#!/bin/bash
set -euo pipefail

SURFACE="${1:?surface id required}"
shift

if [ $# -eq 0 ]; then
  echo "message text required" >&2
  exit 1
fi

MESSAGE="$*"

cmux send --surface "$SURFACE" "$MESSAGE"
sleep 3
cmux send-key --surface "$SURFACE" enter
