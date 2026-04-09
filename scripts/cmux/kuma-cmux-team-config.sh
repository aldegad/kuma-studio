#!/bin/bash
set -euo pipefail

KUMA_TEAM_JSON_PATH="${KUMA_TEAM_JSON_PATH:-$HOME/.kuma/team.json}"
DEFAULT_CLAUDE_MODEL="claude-opus-4-6"
DEFAULT_CLAUDE_OPTIONS="--dangerously-skip-permissions"
DEFAULT_CODEX_MODEL="gpt-5.4"
DEFAULT_CODEX_OPTIONS='--dangerously-bypass-approvals-and-sandbox -c service_tier=fast'

normalize_member_name() {
  local raw="${1:-}"
  if [[ "$raw" == *" "* ]]; then
    printf '%s\n' "${raw#* }"
    return
  fi
  printf '%s\n' "$raw"
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
  jq -c \
    --arg name "$name" \
    --arg defaultClaudeModel "$DEFAULT_CLAUDE_MODEL" \
    --arg defaultClaudeOptions "$DEFAULT_CLAUDE_OPTIONS" \
    --arg defaultCodexModel "$DEFAULT_CODEX_MODEL" \
    --arg defaultCodexOptions "$DEFAULT_CODEX_OPTIONS" '
    .teams
    | to_entries[]
    | .key as $teamId
    | (.value.members // [])[]
    | select(.name == $name)
    | (.spawnType // (if ((.spawnModel // "") | startswith("gpt-")) then "codex" else "claude" end)) as $type
    | {
        id: (.id // ""),
        name: (.name // ""),
        emoji: (.emoji // ""),
        role: (.roleLabel.ko // .role // ""),
        team: (.team // $teamId),
        nodeType: (.nodeType // "worker"),
        type: $type,
        model: (.spawnModel // (if $type == "codex" then $defaultCodexModel else $defaultClaudeModel end)),
        options: (.spawnOptions // (if $type == "codex" then $defaultCodexOptions else $defaultClaudeOptions end))
      }
    ' "$KUMA_TEAM_JSON_PATH"
}

team_config_get_member_field() {
  local name="$1"
  local field="$2"
  local member_json
  member_json="$(team_config_get_member_json "$name")"
  [ -n "$member_json" ] || return 0
  printf '%s\n' "$member_json" | jq -r --arg field "$field" '.[$field] // empty'
}

team_config_member_exists() {
  local name="$1"
  jq -e --arg name "$name" '
    any(
      .teams
      | to_entries[]
      | (.value.members // [])[];
      (.name // "") == $name
    )
  ' "$KUMA_TEAM_JSON_PATH" > /dev/null
}

normalize_codex_options() {
  local options="${1:-}"
  if [ -z "$options" ]; then
    printf '%s\n' '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast'
    return
  fi
  printf '%s\n' "$options"
}

codex_options_have_setting() {
  local options="${1:-}"
  local setting="${2:?setting required}"
  printf '%s\n' "$options" | grep -Eq "(^|[[:space:]])-c[[:space:]]+${setting}="
}

ensure_codex_runtime_settings() {
  local options="${1:-}"
  options="$(normalize_codex_options "$options")"

  if ! codex_options_have_setting "$options" "model_reasoning_effort"; then
    options="$options -c model_reasoning_effort=\"medium\""
  fi

  if ! codex_options_have_setting "$options" "service_tier"; then
    options="$options -c service_tier=fast"
  fi

  printf '%s\n' "$options"
}

build_member_command() {
  local raw_name="$1"
  local explicit_type="${2:-}"
  local dir="$3"
  local name type model options

  name="$(normalize_member_name "$raw_name")"
  require_team_config

  type="$explicit_type"
  model=""
  options=""

  if team_config_member_exists "$name"; then
    type="$(team_config_get_member_field "$name" type)"
    model="$(team_config_get_member_field "$name" model)"
    options="$(team_config_get_member_field "$name" options)"
  fi

  if [ "$type" = "codex" ]; then
    options="$(ensure_codex_runtime_settings "$options")"
  fi

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
      echo "ERROR: Unknown type '$type' for member '$name'" >&2
      exit 1
      ;;
  esac
}

list_team_members() {
  local team="$1"
  local node_type="${2:-}"

  if [ -n "$node_type" ]; then
    jq -r --arg team "$team" --arg nodeType "$node_type" '
      (.teams[$team].members // [])[]
      | select((.nodeType // "worker") == $nodeType)
      | .name
    ' "$KUMA_TEAM_JSON_PATH"
  else
    jq -r --arg team "$team" '
      (.teams[$team].members // [])[]
      | .name
    ' "$KUMA_TEAM_JSON_PATH"
  fi
}

list_spawn_members() {
  jq -r '
    .teams
    | to_entries[]
    | select(.key != "system")
    | (.value.members // [])[]
    | .name
  ' "$KUMA_TEAM_JSON_PATH"
}

member_display_label() {
  local name="$1"
  local emoji
  emoji="$(team_config_get_member_field "$name" emoji)"
  if [ -n "$emoji" ]; then
    printf '%s %s\n' "$emoji" "$name"
    return
  fi
  printf '%s\n' "$name"
}
