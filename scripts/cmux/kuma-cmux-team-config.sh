#!/bin/bash
set -euo pipefail

KUMA_TEAM_CONFIG_PATH="$(node -e 'const fs = require("node:fs"); const input = process.argv[1]; try { process.stdout.write(fs.realpathSync(input)); } catch { process.stdout.write(input); }' "${BASH_SOURCE[0]}")"
KUMA_TEAM_CONFIG_DIR="$(cd "$(dirname "$KUMA_TEAM_CONFIG_PATH")" && pwd)"

find_kuma_repo_root() {
  local dir="$KUMA_TEAM_CONFIG_DIR"

  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && [ -f "$dir/packages/shared/team-normalizer-cli.mjs" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

KUMA_TEAM_JSON_PATH="${KUMA_TEAM_JSON_PATH:-$HOME/.kuma/team.json}"
KUMA_REPO_ROOT="${KUMA_REPO_ROOT:-$(find_kuma_repo_root || pwd)}"
KUMA_TEAM_NORMALIZER_CLI="${KUMA_TEAM_NORMALIZER_CLI:-$KUMA_REPO_ROOT/packages/shared/team-normalizer-cli.mjs}"

normalize_member_name() {
  local raw="${1:-}"
  if [[ "$raw" == *" "* ]]; then
    printf '%s\n' "${raw#* }"
    return
  fi
  printf '%s\n' "$raw"
}

run_team_normalizer_cli() {
  [ -f "$KUMA_TEAM_NORMALIZER_CLI" ] || {
    echo "ERROR: team normalizer bridge not found: $KUMA_TEAM_NORMALIZER_CLI" >&2
    exit 1
  }
  node "$KUMA_TEAM_NORMALIZER_CLI" "$@"
}

team_config_exists() {
  [ -f "$KUMA_TEAM_JSON_PATH" ]
}

require_team_config() {
  if ! team_config_exists; then
    echo "ERROR: team config not found at $KUMA_TEAM_JSON_PATH" >&2
    exit 1
  fi
}

team_config_get_member_json() {
  local name="$1"
  run_team_normalizer_cli member-json "$KUMA_TEAM_JSON_PATH" "$name"
}

team_config_get_member_field() {
  local name="$1"
  local field="$2"
  run_team_normalizer_cli member-field "$KUMA_TEAM_JSON_PATH" "$name" "$field"
}

team_config_member_exists() {
  local name="$1"
  run_team_normalizer_cli member-exists "$KUMA_TEAM_JSON_PATH" "$name" > /dev/null
}

parse_shell_member_record() {
  local member_json="${1:?member json required}"
  printf '%s' "$member_json" | node -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const record = [
      data.displayName || "",
      data.type || "",
      data.model || "",
      data.options || "",
      data.emoji || "",
    ];
    process.stdout.write(`${record.join("\x1f")}\n`);
  '
}

resolve_member_launch_record() {
  local raw_name="$1"
  local explicit_type="${2:-}"
  local name

  name="$(normalize_member_name "$raw_name")"
  require_team_config
  run_team_normalizer_cli resolve-launch-record "$KUMA_TEAM_JSON_PATH" "$name" "$explicit_type"
}

build_member_command_from_record() {
  local dir="$1"
  local record="${2:?launch record required}"
  local _name type model options _emoji
  IFS=$'\x1f' read -r _name type model options _emoji <<< "$record"

  case "$type" in
    claude)
      printf 'cd "%s" && KUMA_ROLE=worker claude --model %q %s' "$dir" "$model" "$options"
      ;;
    codex)
      printf 'cd "%s" && KUMA_ROLE=worker codex -m %q %s' "$dir" "$model" "$options"
      ;;
    sonnet)
      printf 'cd "%s" && KUMA_ROLE=worker claude --model sonnet --dangerously-skip-permissions' "$dir"
      ;;
    *)
      echo "ERROR: Unknown type '$type'" >&2
      exit 1
      ;;
  esac
}

build_member_command() {
  local raw_name="$1"
  local explicit_type="${2:-}"
  local dir="$3"
  local record

  record="$(resolve_member_launch_record "$raw_name" "$explicit_type")"
  build_member_command_from_record "$dir" "$record"
}

member_display_label_from_record() {
  local fallback_name="$1"
  local record="${2:-}"
  local _name _type _model _options emoji

  if [ -n "$record" ]; then
    IFS=$'\x1f' read -r _name _type _model _options emoji <<< "$record"
  else
    emoji=""
  fi

  if [ -n "$emoji" ]; then
    printf '%s %s\n' "$emoji" "$fallback_name"
    return
  fi
  printf '%s\n' "$fallback_name"
}

list_team_members() {
  local team="$1"
  local node_type="${2:-}"
  node --input-type=module - "$KUMA_TEAM_JSON_PATH" "$team" "$node_type" "$KUMA_REPO_ROOT/packages/shared/team-normalizer.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [, , configPath, teamId, nodeType, normalizerPath] = process.argv;
const { normalizeAllTeams } = await import(pathToFileURL(normalizerPath).href);
const data = normalizeAllTeams(JSON.parse(readFileSync(configPath, "utf8")));

for (const member of data.members) {
  if (member.team !== teamId) {
    continue;
  }
  if (nodeType && member.nodeType !== nodeType) {
    continue;
  }
  process.stdout.write(`${member.name.ko}\n`);
}
NODE
}

list_bootstrap_system_members() {
  run_team_normalizer_cli list-bootstrap-system-members "$KUMA_TEAM_JSON_PATH"
}

list_project_spawn_members() {
  run_team_normalizer_cli list-project-spawn-members "$KUMA_TEAM_JSON_PATH"
}

list_spawn_members() {
  # Backward-compatible alias: project init/resync paths should use the
  # explicit project-only helper instead of the ambiguous legacy name.
  list_project_spawn_members
}

member_display_label() {
  local name="$1"
  local record="${2:-}"

  if [ -n "$record" ]; then
    member_display_label_from_record "$name" "$record"
    return
  fi

  if team_config_exists; then
    local member_json
    if member_json="$(team_config_get_member_json "$name" 2>/dev/null)"; then
      local parsed_record
      parsed_record="$(parse_shell_member_record "$member_json")"
      member_display_label_from_record "$name" "$parsed_record"
      return
    fi
  fi

  printf '%s\n' "$name"
}
