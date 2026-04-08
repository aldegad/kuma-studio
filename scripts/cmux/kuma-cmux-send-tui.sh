#!/bin/bash
# Thin wrapper around kuma-cmux-send.sh for backwards compatibility.
# Delegates all work (paste + Enter + retry + verification) to the robust script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/kuma-cmux-send.sh" "$@"
