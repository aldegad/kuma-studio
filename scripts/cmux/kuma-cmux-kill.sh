#!/bin/bash
# Usage: kuma-cmux-kill.sh <surface>
# Closes a cmux surface
set -euo pipefail

SURFACE="${1:?surface required (e.g. surface:3)}"

cmux close-surface --surface "$SURFACE"
