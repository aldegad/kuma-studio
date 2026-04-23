#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${KUMA_STUDIO_PORT:-4312}"
HOST="${KUMA_STUDIO_HOST:-127.0.0.1}"
DEFAULT_EXPLORER_GLOBAL_ROOTS="vault,claude,codex"

resolve_path() {
  local input="${1:-}"
  if [[ -z "${input}" ]]; then
    return 1
  fi

  (
    cd "${input}" 2>/dev/null && pwd -P
  )
}

resolve_process_env_value() {
  local pid="${1:-}"
  local key="${2:-}"
  local proc_env=""

  [[ -n "${pid}" && -n "${key}" ]] || return 1

  if [[ -r "/proc/${pid}/environ" ]]; then
    proc_env="$(tr '\0' '\n' < "/proc/${pid}/environ" | grep "^${key}=" | head -n 1 || true)"
    [[ -n "${proc_env}" ]] || return 1
    printf '%s\n' "${proc_env#${key}=}"
    return 0
  fi

  proc_env="$(ps eww -p "${pid}" -o command= 2>/dev/null || true)"
  [[ -n "${proc_env}" ]] || return 1

  printf '%s\n' "${proc_env}" | awk -v key="${key}" '
    {
      for (i = 1; i <= NF; i += 1) {
        if (index($i, key "=") == 1) {
          sub("^" key "=", "", $i)
          print $i
          found = 1
          exit
        }
      }
    }
    END {
      if (!found) {
        exit 1
      }
    }
  '
}

resolve_default_workspace_binding() {
  local resolver="${ROOT_DIR}/scripts/resolve-default-workspace.mjs"
  if [[ -f "${resolver}" ]]; then
    node "${resolver}"
    return
  fi

  printf 'ERROR: unable to resolve workspace binding; set KUMA_STUDIO_WORKSPACE or register project roots in ~/.kuma/projects.json\n' >&2
  return 2
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
existing_listener_pid="$(printf '%s\n' "${existing_pids}" | head -n 1)"

if [[ -z "${WORKSPACE_BINDING}" && -n "${existing_listener_pid}" ]]; then
  existing_workspace="$(resolve_process_env_value "${existing_listener_pid}" "KUMA_STUDIO_WORKSPACE" 2>/dev/null || true)"
  if [[ -n "${existing_workspace}" ]]; then
    WORKSPACE_BINDING="$(resolve_path "${existing_workspace}" || printf '%s' "${existing_workspace}")"
  fi
fi

if [[ -z "${WORKSPACE_BINDING}" ]]; then
  WORKSPACE_BINDING="$(resolve_default_workspace_binding)"
fi

EXPLORER_GLOBAL_ROOTS_BINDING=""
EXPLORER_GLOBAL_ROOTS_IS_SET=0
if [[ -n "${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS+x}" ]]; then
  EXPLORER_GLOBAL_ROOTS_BINDING="${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS}"
  EXPLORER_GLOBAL_ROOTS_IS_SET=1
elif [[ -n "${existing_listener_pid}" ]]; then
  if EXPLORER_GLOBAL_ROOTS_BINDING="$(resolve_process_env_value "${existing_listener_pid}" "KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS" 2>/dev/null)"; then
    EXPLORER_GLOBAL_ROOTS_IS_SET=1
  fi
fi

if [[ "${EXPLORER_GLOBAL_ROOTS_IS_SET}" -eq 0 ]]; then
  EXPLORER_GLOBAL_ROOTS_BINDING="${DEFAULT_EXPLORER_GLOBAL_ROOTS}"
fi

if [[ -n "${existing_pids}" ]]; then
  echo "Reloading kuma-studio server on port ${PORT}: stopping existing listener(s) ${existing_pids}"
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    kill -9 "${pid}" 2>/dev/null || true
  done <<< "${existing_pids}"
  sleep 2
fi

echo "Starting kuma-studio server on http://${HOST}:${PORT} (workspace: ${WORKSPACE_BINDING})"
if [[ -n "${WORKSPACE_BINDING}" ]]; then
  exec env KUMA_STUDIO_WORKSPACE="${WORKSPACE_BINDING}" \
    KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS="${EXPLORER_GLOBAL_ROOTS_BINDING}" \
    node "${ROOT_DIR}/packages/server/src/cli.mjs" serve --host "${HOST}" --port "${PORT}" --root "${ROOT_DIR}"
fi

exec env KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS="${EXPLORER_GLOBAL_ROOTS_BINDING}" \
  node "${ROOT_DIR}/packages/server/src/cli.mjs" serve --host "${HOST}" --port "${PORT}" --root "${ROOT_DIR}"
