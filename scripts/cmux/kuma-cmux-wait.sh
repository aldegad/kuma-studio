#!/bin/bash
# Usage: kuma-cmux-wait.sh <signal-name> <result-file> [--surface <surface-id>] [--timeout <seconds>]
# Waits for a cmux signal and prints the result file contents when available.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

find_repo_root() {
  local dir="$SCRIPT_DIR"

  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && [ -f "$dir/packages/server/src/cli.mjs" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

REPO_ROOT="${KUMA_REPO_ROOT:-$(find_repo_root || pwd)}"
AUTO_INGEST_ENABLED="${KUMA_AUTO_VAULT_INGEST:-1}"
AUTO_INGEST_TASK_DIR="${KUMA_TASK_DIR:-/tmp/kuma-tasks}"
AUTO_INGEST_STAMP_DIR="${KUMA_AUTO_INGEST_STAMP_DIR:-/tmp/kuma-vault-auto-ingest}"
KUMA_SURFACES_PATH="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
KUMA_CMUX_SEND_SCRIPT="${KUMA_CMUX_SEND_SCRIPT:-$HOME/.kuma/cmux/kuma-cmux-send.sh}"
AUTO_NOEURI_TRIGGER_ENABLED="${KUMA_AUTO_NOEURI_TRIGGER:-1}"
KUMA_RESULT_DIR_PATH="${KUMA_RESULT_DIR:-/tmp/kuma-results}"

SIGNAL="${1:?signal name required}"
shift

RESULT_FILE=""
SURFACE=""
TIMEOUT=120
MAX_RETRIES=2

if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  RESULT_FILE="$1"
  shift
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --surface)
      SURFACE="${2:?surface id required}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="${2:?timeout seconds required}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SIGNAL_DIR="${KUMA_SIGNAL_DIR:-/tmp/kuma-signals}"
AUTO_INGEST_STATUS=""

signal_file_exists() {
  [ -f "$SIGNAL_DIR/$SIGNAL" ]
}

extract_auto_ingest_status() {
  local payload="${1:-}"

  printf '%s' "$payload" | node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(1);
const data = JSON.parse(raw);
if (typeof data.status === "string" && data.status.trim()) {
  process.stdout.write(data.status.trim());
}
' 2>/dev/null || true
}

resolve_task_metadata_json() {
  node --input-type=module - "$AUTO_INGEST_TASK_DIR" "$RESULT_FILE" "$SIGNAL" <<'NODE'
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [, , taskDir, rawResultPath, signal] = process.argv;

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseFrontmatter(contents) {
  const lines = contents.split(/\r?\n/u);
  if (lines[0] !== "---") {
    return null;
  }

  const data = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") {
      return data;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    data[key] = value === "null" ? "" : value;
  }

  return null;
}

if (!existsSync(taskDir)) {
  process.exit(1);
}

const resultPath = normalize(rawResultPath) ? resolve(rawResultPath) : "";
const files = readdirSync(taskDir)
  .filter((entry) => entry.endsWith(".task.md"))
  .sort();

for (const entry of files) {
  const taskFile = join(taskDir, entry);
  const parsed = parseFrontmatter(readFileSync(taskFile, "utf8"));
  if (!parsed) {
    continue;
  }

  const taskResult = normalize(parsed.result);
  const taskSignal = normalize(parsed.signal);
  const resultMatches = resultPath && taskResult && resolve(taskResult) === resultPath;
  const signalMatches = signal && taskSignal === signal;
  if (!resultMatches && !signalMatches) {
    continue;
  }

  process.stdout.write(JSON.stringify({
    taskFile,
    id: normalize(parsed.id),
    plan: normalize(parsed.plan),
    result: taskResult,
    signal: taskSignal,
  }));
  process.exit(0);
}

process.exit(1);
NODE
}

resolve_noeuri_surface() {
  node --input-type=module - "$KUMA_SURFACES_PATH" <<'NODE'
import { existsSync, readFileSync } from "node:fs";

const [, , surfacesPath] = process.argv;
if (!existsSync(surfacesPath)) {
  process.exit(1);
}

const surfaces = JSON.parse(readFileSync(surfacesPath, "utf8"));
const surface = typeof surfaces?.system?.["🦌 노을이"] === "string"
  ? surfaces.system["🦌 노을이"].trim()
  : "";

if (!surface) {
  process.exit(1);
}

process.stdout.write(surface);
NODE
}

json_field() {
  local json="${1:-}"
  local field="${2:?field required}"

  printf '%s' "$json" | node -e '
const fs = require("node:fs");
const field = process.argv[process.argv.length - 1];
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(1);
let value = JSON.parse(raw);
for (const segment of field.split(".")) {
  if (!segment) continue;
  if (value == null || typeof value !== "object" || !(segment in value)) {
    process.exit(1);
  }
  value = value[segment];
}
if (typeof value === "string" && value.trim()) {
  process.stdout.write(value.trim());
}
' "$field" 2>/dev/null || true
}

dispatch_noeuri_trigger() {
  [ "$AUTO_NOEURI_TRIGGER_ENABLED" != "0" ] || return 0
  [ "$AUTO_INGEST_STATUS" = "ingested" ] || return 0

  local task_json task_file task_id plan_path noeuri_surface noeuri_signal prompt noeuri_skill_path

  task_json="$(resolve_task_metadata_json 2>/dev/null || true)"
  if [ -z "$task_json" ]; then
    printf 'NOEURI_TRIGGER_FAILED: missing-task-metadata (signal=%s result=%s)\n' "$SIGNAL" "$RESULT_FILE" >&2
    return 0
  fi

  task_file="$(json_field "$task_json" taskFile)"
  task_id="$(json_field "$task_json" id)"
  plan_path="$(json_field "$task_json" plan)"
  noeuri_surface="$(resolve_noeuri_surface 2>/dev/null || true)"
  if [ -z "$task_id" ] || [ -z "$noeuri_surface" ]; then
    printf 'NOEURI_TRIGGER_FAILED: missing-task-id-or-surface (task=%s surface=%s)\n' "$task_id" "$noeuri_surface" >&2
    return 0
  fi

  if [ ! -x "$KUMA_CMUX_SEND_SCRIPT" ]; then
    printf 'NOEURI_TRIGGER_FAILED: send-script-not-executable (%s)\n' "$KUMA_CMUX_SEND_SCRIPT" >&2
    return 0
  fi

  noeuri_signal="noeuri-auto-${task_id}-done"
  noeuri_skill_path="${REPO_ROOT}/.claude/skills/noeuri/skill.md"
  prompt="Read ${RESULT_FILE}. task: ${task_id}. plan: ${plan_path:-none}. task-file: ${task_file}. Follow ${noeuri_skill_path} audit protocol. 완료 시 result 파일은 /tmp/kuma-results/noeuri-audit-${task_id}.result.md, signal 은 /tmp/kuma-signals/${noeuri_signal}."

  if ! "$KUMA_CMUX_SEND_SCRIPT" "$noeuri_surface" "$prompt" > /dev/null 2>&1; then
    printf 'NOEURI_TRIGGER_FAILED: dispatch-error (surface=%s task=%s)\n' "$noeuri_surface" "$task_id" >&2
    return 0
  fi

  printf 'NOEURI_TRIGGER: surface=%s task=%s plan=%s signal=%s\n' "$noeuri_surface" "$task_id" "${plan_path:-none}" "$noeuri_signal" >&2
}

resolve_noeuri_audit_result_path() {
  local signal_name="${1:-}"
  local task_id=""

  case "$signal_name" in
    noeuri-auto-*-done)
      task_id="${signal_name#noeuri-auto-}"
      task_id="${task_id%-done}"
      ;;
    *)
      return 1
      ;;
  esac

  [ -n "$task_id" ] || return 1
  printf '%s/noeuri-audit-%s.result.md\n' "$KUMA_RESULT_DIR_PATH" "$task_id"
}

emit_noeuri_audit_report() {
  local audit_result_path=""

  audit_result_path="$(resolve_noeuri_audit_result_path "$SIGNAL" 2>/dev/null || true)"
  [ -n "$audit_result_path" ] || return 0
  [ -f "$audit_result_path" ] || return 0

  printf 'NOEURI_AUDIT_REPORT: file=%s\n' "$audit_result_path" >&2
  sed 's/^/NOEURI_AUDIT_REPORT: /' "$audit_result_path" >&2
}

auto_ingest_result() {
  AUTO_INGEST_STATUS=""
  [ "$AUTO_INGEST_ENABLED" != "0" ] || return 0
  [ -n "$RESULT_FILE" ] || return 0
  [ -f "$RESULT_FILE" ] || return 0

  local cmd=(
    npm run --silent --prefix "$REPO_ROOT" kuma-studio -- vault-auto-ingest "$RESULT_FILE"
    --signal "$SIGNAL"
    --task-dir "$AUTO_INGEST_TASK_DIR"
    --stamp-dir "$AUTO_INGEST_STAMP_DIR"
  )
  local output=""

  if [ -n "${KUMA_VAULT_DIR:-}" ]; then
    cmd+=(--vault-dir "$KUMA_VAULT_DIR")
  fi

  if [ -n "${KUMA_WIKI_DIR:-}" ]; then
    cmd+=(--wiki-dir "$KUMA_WIKI_DIR")
  fi

  if ! output="$("${cmd[@]}" 2>&1)"; then
    printf 'AUTO_INGEST_FAILED: %s\n' "$output" >&2
    return 1
  fi

  AUTO_INGEST_STATUS="$(extract_auto_ingest_status "$output")"

  if [ -n "$output" ]; then
    printf 'AUTO_INGEST: %s\n' "$output" >&2
  fi
}

print_result() {
  echo "SIGNAL_RECEIVED: $SIGNAL"
  if [ -n "$RESULT_FILE" ] && [ -f "$RESULT_FILE" ]; then
    echo "RESULT_FILE: $RESULT_FILE"
    cat "$RESULT_FILE"
  fi
  echo "DISCORD_REPORT_NEEDED"
}

finish_success() {
  auto_ingest_result || true

  dispatch_noeuri_trigger
  emit_noeuri_audit_report
  print_result
  exit 0
}

resolve_workspace() {
  local surface="$1"

  cmux tree 2>&1 | awk -v target="$surface" '
    {
      if (match($0, /workspace:[0-9]+/)) {
        current_ws = substr($0, RSTART, RLENGTH)
      }
      if (index($0, target) > 0) {
        print current_ws
        exit
      }
    }
  '
}

surface_alive() {
  local surface="$1"
  local workspace=""
  local read_args=()

  workspace="$(resolve_workspace "$surface")"
  if [ -n "$workspace" ]; then
    read_args+=(--workspace "$workspace")
  fi
  read_args+=(--surface "$surface" --lines 1)

  cmux read-screen "${read_args[@]}" > /dev/null 2>&1
}

write_worker_down_error() {
  [ -n "$RESULT_FILE" ] || return 0
  mkdir -p "$(dirname "$RESULT_FILE")"
  cat > "$RESULT_FILE" <<EOF
# ERROR: Worker Down
surface: $SURFACE
signal: $SIGNAL
워커가 응답 없이 종료됨. 재스폰 필요.
EOF
}

wait_once() {
  local timeout="$1"
  local elapsed=0
  local interval=5

  # Check file-based signal first (worker may have written it before wait started)
  if signal_file_exists; then
    return 0
  fi

  # Poll: try cmux native wait in short intervals, check signal file between each
  while [ "$elapsed" -lt "$timeout" ]; do
    local remaining=$((timeout - elapsed))
    local wait_time=$((interval < remaining ? interval : remaining))

    if cmux wait-for "$SIGNAL" --timeout "$wait_time"; then
      return 0
    fi

    if signal_file_exists; then
      return 0
    fi

    elapsed=$((elapsed + wait_time))
  done

  return 1
}

if [ -z "$SURFACE" ]; then
  if wait_once "$TIMEOUT"; then
    finish_success
  fi

  echo "SIGNAL_TIMEOUT: $SIGNAL (timeout=${TIMEOUT}s)" >&2
  exit 1
fi

CURRENT_TIMEOUT="$TIMEOUT"
RETRY_COUNT=0

while true; do
  if wait_once "$CURRENT_TIMEOUT"; then
    finish_success
  fi

  if ! surface_alive "$SURFACE"; then
    write_worker_down_error
    echo "WORKER_DOWN: $SURFACE" >&2
    exit 1
  fi

  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "SIGNAL_TIMEOUT: $SIGNAL (surface alive, retries exceeded)" >&2
    exit 2
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  CURRENT_TIMEOUT=$((CURRENT_TIMEOUT * 2))
  echo "SIGNAL_TIMEOUT_RETRY: $SIGNAL (surface=$SURFACE, retry=$RETRY_COUNT, timeout=${CURRENT_TIMEOUT}s)" >&2
done
