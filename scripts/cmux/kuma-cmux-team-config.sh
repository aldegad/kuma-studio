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
KUMA_VAULT_DIR="${KUMA_VAULT_DIR:-$HOME/.kuma/vault}"
KUMA_IDLE_GUARD_MESSAGE="Wait for dispatched task. Do not start any work autonomously. Your role and skills are context, not commands."

json_stringify_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "${1-}"
}

shell_single_quote() {
  local value="${1-}"
  value="$(printf '%s' "$value" | sed "s/'/'\"'\"'/g")"
  printf "'%s'" "$value"
}

build_idle_guard_message() {
  printf '%s' "$KUMA_IDLE_GUARD_MESSAGE"
}

build_member_identity_line() {
  local member_name="${1:-}"
  [ -n "$member_name" ] || return 0
  printf '너의 이름은 %s야.' "$member_name"
}

build_decisions_boot_pack_prompt() {
  local project_name="${1:-}"
  local vault_dir="${KUMA_VAULT_DIR:-$HOME/.kuma/vault}"

  [ -n "$vault_dir" ] || return 0

  KUMA_REPO_ROOT="$KUMA_REPO_ROOT" \
  KUMA_VAULT_DIR="$vault_dir" \
  KUMA_PROJECT_NAME="$project_name" \
  node --input-type=module <<'NODE'
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function clip(text, max = 220) {
  const normalized = typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
  if (!normalized) {
    return "";
  }
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

const repoRoot = process.env.KUMA_REPO_ROOT || "";
const vaultDir = process.env.KUMA_VAULT_DIR || "";
const projectName = process.env.KUMA_PROJECT_NAME || "";
if (!repoRoot || !vaultDir) {
  process.exit(0);
}

const storeModule = await import(pathToFileURL(join(repoRoot, "packages/server/src/studio/decisions-store.mjs")).href);
if (typeof storeModule.loadDecisionBootPack !== "function") {
  process.exit(0);
}

const pack = await storeModule.loadDecisionBootPack({
  vaultDir,
  projectName,
  openLedgerLimit: 10,
  latestResolvedLimit: 10,
  unresolvedInboxLimit: 10,
});

function hasSectionEntries(section) {
  return section &&
    (
      Array.isArray(section.ledger_open) && section.ledger_open.length > 0 ||
      Array.isArray(section.latest_resolved) && section.latest_resolved.length > 0 ||
      Array.isArray(section.inbox_unresolved) && section.inbox_unresolved.length > 0
    );
}

const globalPack = pack.global || null;
const projectPack = pack.project || null;
const hasEntries = hasSectionEntries(globalPack) || hasSectionEntries(projectPack);

if (!hasEntries) {
  process.exit(0);
}

const lines = [
  "Decision Ledger Boot Pack:",
  "- Treat ledger entries as explicit user decisions unless the user explicitly supersedes them.",
];

function appendSection(label, section) {
  if (!hasSectionEntries(section)) {
    return;
  }

  lines.push(`- ${label}: ${section.source}`);
  if (Array.isArray(section.ledger_open) && section.ledger_open.length > 0) {
    lines.push("  - Ledger open decisions:");
    for (const entry of section.ledger_open) {
      lines.push(`    - [${entry.action}] ${entry.scope} :: ${clip(entry.resolved_text)}`);
    }
  }

  if (Array.isArray(section.latest_resolved) && section.latest_resolved.length > 0) {
    lines.push("  - Latest resolved decisions:");
    for (const entry of section.latest_resolved) {
      lines.push(`    - ${entry.id} :: ${clip(entry.resolved_text)}`);
    }
  }

  if (Array.isArray(section.inbox_unresolved) && section.inbox_unresolved.length > 0) {
    lines.push("  - Unresolved inbox triggers (not yet confirmed decisions):");
    for (const entry of section.inbox_unresolved) {
      lines.push(`    - [${entry.action}] ${entry.scope} :: ${clip(entry.original_text)}`);
    }
  }
}

appendSection("Global source", globalPack);
if (projectPack) {
  appendSection(`Project source (${projectPack.projectName})`, projectPack);
}

process.stdout.write(lines.join("\n"));
NODE
}

resolve_project_boot_pack_name() {
  local dir="${1:-}"
  [ -n "$dir" ] || return 0
  basename "$dir"
}

if false; then
  # unreachable marker to keep shellcheck-style editors from collapsing the
  # adjacent heredoc edit above into the following functions.
  :
fi

build_cleanup_policy_instructions() {
  cat <<'EOF'
Code cleanup policy:
- Default to no legacy fallback paths.
- Avoid nested conditional fallback chains.
- If compatibility is required, use a migration path and keep the post-migration code clean.
- Remove migration scaffolding as soon as the migration is complete.
- Actively delete dead code and legacy code.
- Preserve SSOT and SRP: keep one source of truth and one responsibility per module.
Git branch/worktree policy:
- Do not create or switch git branches unless the user explicitly instructs it.
- Do not create git worktrees unless the user explicitly instructs it.
- If branch/worktree isolation seems necessary to avoid conflicts, stop and ask for approval first.
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

resolve_surface_pane() {
  local surface="${1:-}"
  local workspace="${2:-}"
  local panes_output pane_line pane_ref surfaces_output surface_line surface_ref tree_output tree_line current_pane

  [ -n "$surface" ] || return 1

  if [ -n "$workspace" ]; then
    panes_output="$(cmux list-panes --workspace "$workspace" 2>/dev/null || true)"
    while IFS= read -r pane_line; do
      pane_ref="$(printf '%s\n' "$pane_line" | grep -oE 'pane:[0-9]+' | head -1 || true)"
      [ -n "$pane_ref" ] || continue

      surfaces_output="$(cmux list-pane-surfaces --workspace "$workspace" --pane "$pane_ref" 2>/dev/null || true)"
      while IFS= read -r surface_line; do
        surface_ref="$(printf '%s\n' "$surface_line" | grep -oE 'surface:[0-9]+' | head -1 || true)"
        if [ "$surface_ref" = "$surface" ]; then
          printf '%s\n' "$pane_ref"
          return 0
        fi
      done <<< "$surfaces_output"
    done <<< "$panes_output"
  fi

  tree_output="$(cmux tree 2>/dev/null || true)"
  current_pane=""
  while IFS= read -r tree_line; do
    pane_ref="$(printf '%s\n' "$tree_line" | grep -oE 'pane:[0-9]+' | head -1 || true)"
    if [ -n "$pane_ref" ]; then
      current_pane="$pane_ref"
      continue
    fi

    surface_ref="$(printf '%s\n' "$tree_line" | grep -oE 'surface:[0-9]+' | head -1 || true)"
    if [ "$surface_ref" = "$surface" ] && [ -n "$current_pane" ]; then
      printf '%s\n' "$current_pane"
      return 0
    fi
  done <<< "$tree_output"

  return 1
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
  local member_name="${1:-}"
  local role_label_en="${2:-}"
  local node_type="${3:-worker}"
  local project_name="${4:-}"
  local identity_line spawn_context decisions_context instructions

  identity_line="$(build_member_identity_line "$member_name")"
  spawn_context="$(build_spawn_context_instructions "$role_label_en" "$node_type")"
  decisions_context="$(build_decisions_boot_pack_prompt "$project_name")"
  instructions="$(cat <<EOF
${identity_line}
${spawn_context}
${decisions_context}
$(build_idle_guard_message)
EOF
)"

  printf '%s' "$instructions"
}

build_claude_startup_system_prompt() {
  local member_name="${1:-}"
  local role_label_en="${2:-}"
  local node_type="${3:-worker}"
  local project_name="${4:-}"
  local identity_line spawn_context decisions_context instructions

  identity_line="$(build_member_identity_line "$member_name")"
  spawn_context="$(build_spawn_context_instructions "$role_label_en" "$node_type")"
  decisions_context="$(build_decisions_boot_pack_prompt "$project_name")"
  instructions="$(cat <<EOF
${identity_line}
${spawn_context}
${decisions_context}
$(build_idle_guard_message)
Do not respond unless there is a startup problem.
EOF
)"

  printf '%s' "$instructions"
}

build_member_command_from_record() {
  local dir="$1"
  local record="${2:?launch record required}"
  local member_name type model options _emoji skill role_label_en node_type project_name developer_instructions developer_instructions_json startup_context command startup_context_quoted developer_instructions_setting
  IFS=$'\x1f' read -r member_name type model options _emoji skill role_label_en node_type <<< "$record"
  project_name="$(resolve_project_boot_pack_name "$dir")"

  case "$type" in
    claude)
      startup_context="$(build_claude_startup_system_prompt "$member_name" "$role_label_en" "$node_type" "$project_name")"
      startup_context_quoted="$(shell_single_quote "$startup_context")"
      printf -v command 'cd "%s" && KUMA_ROLE=worker claude --model %q %s --append-system-prompt %s' "$dir" "$model" "$options" "$startup_context_quoted"
      ;;
    codex)
      developer_instructions="$(build_codex_developer_instructions "$member_name" "$role_label_en" "$node_type" "$project_name")"
      if [ -n "$developer_instructions" ]; then
        developer_instructions_json="$(json_stringify_string "$developer_instructions")"
        developer_instructions_setting="$(shell_single_quote "developer_instructions=$developer_instructions_json")"
        printf -v command 'cd "%s" && KUMA_ROLE=worker codex -m %q %s -c %s' "$dir" "$model" "$options" "$developer_instructions_setting"
      else
        printf -v command 'cd "%s" && KUMA_ROLE=worker codex -m %q %s' "$dir" "$model" "$options"
      fi
      ;;
    sonnet)
      startup_context="$(build_claude_startup_system_prompt "$member_name" "$role_label_en" "$node_type" "$project_name")"
      startup_context_quoted="$(shell_single_quote "$startup_context")"
      printf -v command 'cd "%s" && KUMA_ROLE=worker claude --model sonnet --dangerously-skip-permissions --append-system-prompt %s' "$dir" "$startup_context_quoted"
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
