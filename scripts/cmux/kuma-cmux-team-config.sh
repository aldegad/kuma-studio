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
KUMA_SURFACE_REGISTRY_CLI="${KUMA_SURFACE_REGISTRY_CLI:-$KUMA_REPO_ROOT/packages/shared/surface-registry-cli.mjs}"
KUMA_IDLE_GUARD_MESSAGE="Wait for dispatched task. Do not start any work autonomously. Your role and skills are context, not commands."

json_stringify_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "${1-}"
}

build_idle_guard_message() {
  printf '%s' "$KUMA_IDLE_GUARD_MESSAGE"
}

build_cleanup_policy_instructions() {
  cat <<'EOF'
Code cleanup policy:
- Default to no legacy fallback paths.
- Avoid nested conditional fallback chains.
- If compatibility is required, use a migration path and keep the post-migration code clean.
- Remove migration scaffolding as soon as the migration is complete.
- Actively delete dead code and legacy code.
- Preserve SSOT and SRP: keep one source of truth and one responsibility per module.
EOF
}

build_spawn_context_instructions() {
  local role_label_en="${1:-}"
  local node_type="${2:-worker}"
  local instructions=""

  if [ -n "$role_label_en" ]; then
    instructions="Primary role: $role_label_en."
  fi

  if [ -n "$instructions" ]; then
    instructions="${instructions}
"
  fi
  instructions="${instructions}Role labels describe responsibility. They are not commands.
Skills are dispatch-time context. Do not invoke any skill on spawn.
$(build_cleanup_policy_instructions)"

  if [ "$node_type" = "team" ]; then
    instructions="${instructions}
Team-node dispatch policy:
- Do not implement directly except for trivial one-line fixes.
- Delegate implementation work with kuma-task.
- Do not use --trust-worker when dispatching worker tasks; worker tasks must go through QA.
- Preferred flow: plan, dispatch, QA pass, aggregate, then report completion."
  fi

  printf '%s' "$instructions"
}

startup_command_has_idle_guard() {
  local command="${1:-}"
  case "$command" in
    *"Wait for dispatched task"*|*"Wait\ for\ dispatched\ task"*)
      return 0
      ;;
  esac
  return 1
}

startup_command_invokes_claude_skill() {
  local command="${1:-}"
  printf '%s\n' "$command" | grep -F -- '-- "/' > /dev/null 2>&1
}

assert_idle_safe_startup_command() {
  local type="${1:-}"
  local command="${2:-}"
  local name="${3:-worker}"

  if [ -z "$command" ]; then
    echo "ERROR: empty startup command for $name" >&2
    exit 1
  fi

  if ! startup_command_has_idle_guard "$command"; then
    echo "ERROR: startup command for $name is missing the idle guard" >&2
    exit 1
  fi

  case "$type" in
    claude|sonnet)
      if startup_command_invokes_claude_skill "$command"; then
        echo "ERROR: Claude startup command for $name must not auto-run slash skills on spawn" >&2
        exit 1
      fi
      ;;
  esac
}

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

run_surface_registry_cli() {
  [ -f "$KUMA_SURFACE_REGISTRY_CLI" ] || {
    echo "ERROR: surface registry bridge not found: $KUMA_SURFACE_REGISTRY_CLI" >&2
    exit 1
  }
  node "$KUMA_SURFACE_REGISTRY_CLI" "$@"
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
      (Array.isArray(data.skills) ? data.skills[0] : "") || "",
      data.roleLabelEn || "",
      data.nodeType || "worker",
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

build_codex_developer_instructions() {
  local role_label_en="${1:-}"
  local node_type="${2:-worker}"
  local instructions

  instructions="$(build_spawn_context_instructions "$role_label_en" "$node_type")
$(build_idle_guard_message)"

  printf '%s' "$instructions"
}

build_claude_startup_system_prompt() {
  local role_label_en="${1:-}"
  local node_type="${2:-worker}"
  local instructions

  instructions="$(build_spawn_context_instructions "$role_label_en" "$node_type")
$(build_idle_guard_message)
Do not respond unless there is a startup problem."

  printf '%s' "$instructions"
}

build_member_command_from_record() {
  local dir="$1"
  local record="${2:?launch record required}"
  local _name type model options _emoji skill role_label_en node_type developer_instructions developer_instructions_json startup_context command
  IFS=$'\x1f' read -r _name type model options _emoji skill role_label_en node_type <<< "$record"

  case "$type" in
    claude)
      startup_context="$(build_claude_startup_system_prompt "$role_label_en" "$node_type")"
      printf -v command 'cd "%s" && KUMA_ROLE=worker claude --model %q %s --append-system-prompt %q' "$dir" "$model" "$options" "$startup_context"
      ;;
    codex)
      developer_instructions="$(build_codex_developer_instructions "$role_label_en" "$node_type")"
      if [ -n "$developer_instructions" ]; then
        developer_instructions_json="$(json_stringify_string "$developer_instructions")"
        printf -v command 'cd "%s" && KUMA_ROLE=worker codex -m %q %s -c %q' "$dir" "$model" "$options" "developer_instructions=$developer_instructions_json"
      else
        printf -v command 'cd "%s" && KUMA_ROLE=worker codex -m %q %s' "$dir" "$model" "$options"
      fi
      ;;
    sonnet)
      startup_context="$(build_claude_startup_system_prompt "$role_label_en")"
      printf -v command 'cd "%s" && KUMA_ROLE=worker claude --model sonnet --dangerously-skip-permissions --append-system-prompt %q' "$dir" "$startup_context"
      ;;
    *)
      echo "ERROR: Unknown type '$type'" >&2
      exit 1
      ;;
  esac

  assert_idle_safe_startup_command "$type" "$command" "${_name:-unknown}"
  printf '%s' "$command"
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
  local _name _type _model _options emoji _skill _role_label _node_type

  if [ -n "$record" ]; then
    IFS=$'\x1f' read -r _name _type _model _options emoji _skill _role_label _node_type <<< "$record"
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
  run_team_normalizer_cli list-team-members "$KUMA_TEAM_JSON_PATH" "$team" "$node_type"
}

list_bootstrap_system_members() {
  run_team_normalizer_cli list-bootstrap-system-members "$KUMA_TEAM_JSON_PATH"
}

list_project_spawn_members() {
  run_team_normalizer_cli list-project-spawn-members "$KUMA_TEAM_JSON_PATH"
}

list_project_spawn_teams() {
  run_team_normalizer_cli list-project-spawn-teams "$KUMA_TEAM_JSON_PATH"
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

resolve_registered_member_surface() {
  local project="${1:?project required}"
  local name="${2:?member name required}"
  local registry_path="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"
  local member_json context_json

  member_json="$(team_config_get_member_json "$name" 2>/dev/null)" || return 1
  context_json="$(run_surface_registry_cli resolve-member-context "$registry_path" "$project" "$member_json" 2>/dev/null)" || return 1
  printf '%s' "$context_json" | node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); if (!data.surface) process.exit(1); process.stdout.write(`${data.surface}\n`);'
}
