#!/bin/bash
# Usage: kuma-cmux-read.sh <surface> [--scrollback]
# Reads current screen content from a cmux surface
set -euo pipefail

SURFACE="${1:?surface required (e.g. surface:3)}"
shift

cmux read-screen --surface "$SURFACE" "$@"
