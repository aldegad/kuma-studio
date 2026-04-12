#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${KUMA_STUDIO_PORT:-4312}"
HOST="${KUMA_STUDIO_HOST:-127.0.0.1}"

resolve_path() {
  local input="${1:-}"
  if [[ -z "${input}" ]]; then
    return 1
  fi

  (
    cd "${input}" 2>/dev/null && pwd -P
  )
}

WORKSPACE_BINDING=""
if [[ -n "${KUMA_STUDIO_WORKSPACE:-}" ]]; then
  WORKSPACE_BINDING="$(resolve_path "${KUMA_STUDIO_WORKSPACE}" || printf '%s' "${KUMA_STUDIO_WORKSPACE}")"
elif [[ -n "${INIT_CWD:-}" ]]; then
  INIT_CWD_RESOLVED="$(resolve_path "${INIT_CWD}" || printf '%s' "${INIT_CWD}")"
  if [[ "${INIT_CWD_RESOLVED}" != "${ROOT_DIR}" ]]; then
    WORKSPACE_BINDING="${INIT_CWD_RESOLVED}"
  fi
fi

existing_pids="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"

if [[ -n "${existing_pids}" ]]; then
  echo "Reloading kuma-studio server on port ${PORT}: stopping existing listener(s) ${existing_pids}"
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    kill -9 "${pid}" 2>/dev/null || true
  done <<< "${existing_pids}"
  sleep 2
fi

if [[ -n "${WORKSPACE_BINDING}" ]]; then
  echo "Starting kuma-studio server on http://${HOST}:${PORT} (workspace: ${WORKSPACE_BINDING})"
  exec env KUMA_STUDIO_WORKSPACE="${WORKSPACE_BINDING}" \
    node "${ROOT_DIR}/packages/server/src/cli.mjs" serve --host "${HOST}" --port "${PORT}" --root "${ROOT_DIR}"
fi

echo "Starting kuma-studio server on http://${HOST}:${PORT} without workspace binding"
echo "Hint: run from the workspace root with --prefix or set KUMA_STUDIO_WORKSPACE explicitly."
exec node "${ROOT_DIR}/packages/server/src/cli.mjs" serve --host "${HOST}" --port "${PORT}" --root "${ROOT_DIR}"
