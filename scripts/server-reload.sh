#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${KUMA_STUDIO_PORT:-4312}"
HOST="${KUMA_STUDIO_HOST:-127.0.0.1}"

existing_pids="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"

if [[ -n "${existing_pids}" ]]; then
  echo "Reloading kuma-studio server on port ${PORT}: stopping existing listener(s) ${existing_pids}"
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    kill -9 "${pid}" 2>/dev/null || true
  done <<< "${existing_pids}"
  sleep 2
fi

echo "Starting kuma-studio server on http://${HOST}:${PORT}"
exec node "${ROOT_DIR}/packages/server/src/cli.mjs" serve --host "${HOST}" --port "${PORT}" --root "${ROOT_DIR}"
