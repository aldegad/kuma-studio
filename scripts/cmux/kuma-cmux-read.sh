#!/bin/bash
# Usage: kuma-cmux-read.sh <surface> [--scrollback]
# Reads current screen content from a cmux surface
set -euo pipefail

RAW_SURFACE="${1:?surface required (e.g. surface:3)}"
shift

# Auto-prefix "surface:" if bare number passed
if [[ "$RAW_SURFACE" =~ ^[0-9]+$ ]]; then
  SURFACE="surface:${RAW_SURFACE}"
else
  SURFACE="$RAW_SURFACE"
fi

cmux read-screen --surface "$SURFACE" "$@"
