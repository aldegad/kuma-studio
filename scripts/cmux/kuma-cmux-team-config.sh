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
KUMA_SYSTEM_PROMPT_PATH="${KUMA_SYSTEM_PROMPT_PATH:-$KUMA_REPO_ROOT/prompts/kuma-system-prompt.md}"
KUMA_IDLE_GUARD_MESSAGE="디스패치된 작업을 기다려. 스스로 작업을 시작하지 마."

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
  local suffix
  [ -n "$member_name" ] || return 0
  suffix="$(node -e '
const name = process.argv[1] ?? "";
const last = Array.from(name.trim()).pop() ?? "";
const code = last.charCodeAt(0);
const hasJongseong = code >= 0xac00 && code <= 0xd7a3 && ((code - 0xac00) % 28) !== 0;
process.stdout.write(hasJongseong ? "이야" : "야");
' "$member_name")"
  printf '너의 이름은 %s%s.' "$member_name" "$suffix"
}

build_kuma_bootstrap_brief_prompt() {
  cat <<'EOF'
쿠마 모드로 부트스트랩 직후 첫 브리핑을 시작해줘.

첫 응답에서는 지금 워크스페이스 기준으로 아래만 짧고 운영자답게 정리해:
- managed infra 상태: `kuma-server`(port 4312, Studio UI 포함)
- 팀 멤버 상태 요약: idle / working
- 최근 커밋 1개와 현재 워크트리 변경 요약
- 마지막 한 줄: 지금 무엇을 시킬지 묻기

규칙:
- 첫 브리핑에서는 bootstrap 직전에 이미 확보된 managed infra 정보를 그대로 요약한다. 추가 probe는 하지 않는다.
- 상태 확인이 정말 더 필요하면 Bash/tool 호출로만 한다. surface 이름을 입력창에 직접 타이핑해서 probe 하지 않는다.
- `kuma-server echo STATUS_CHECK` 같은 문자열을 composer에 남기지 않는다.
- 브리핑을 마칠 때 입력창은 빈 상태여야 한다.
- `kuma-server` 포트는 4312로 본다. 3000/3001로 추정하지 않는다.

바로 브리핑부터 시작해.
EOF
}

build_session_start_prompt() {
  local member_name="${1:-}"

  case "$member_name" in
    쿠마)
      build_kuma_bootstrap_brief_prompt
      ;;
    *)
      return 0
      ;;
  esac
}

resolve_project_name_from_dir() {
  local dir="${1:-}"
  [ -n "$dir" ] || return 0
  basename "$dir"
}

build_spawn_context_instructions() {
  local role_label_en="${1:-}"
  local node_type="${2:-worker}"
  local instructions=""

  if [ -n "$role_label_en" ]; then
    instructions="주 역할: ${role_label_en%.}."
  fi

  if [ -n "$instructions" ]; then
    instructions="${instructions}
"
  fi
  instructions="${instructions}역할 라벨은 책임 범위를 설명한다. 자동 실행 명령이 아니다.
스킬은 디스패치 시점의 참고 맥락이다. 스폰 직후 자동으로 스킬을 실행하지 마.
공유 프로젝트 정책은 repo 지시 파일에 있다. Codex는 AGENTS.md, Claude는 CLAUDE.md를 따른다. startup prompt에 복사된 결정 캐시에 의존하지 마."

  if [ "$node_type" = "team" ]; then
    instructions="${instructions}
팀 노드 운영 규칙:
- 직접 작업은 금지되어 있지 않다. 짧은 수정, 조사, 정리는 직접 처리할 수 있다.
- 작업을 나누는 편이 더 효율적이면 kuma-dispatch assign 으로 위임한다.
- --qa <member> 는 외부 QA 리뷰어가 실제로 필요할 때만 붙인다.
- 기본 흐름은 파악, 직접 처리 또는 위임 선택, 필요 시 QA, 결과 취합이다."
  fi

  printf '%s' "$instructions"
}

startup_command_has_idle_guard() {
  local command="${1:-}"
  local prompt_file=""
  if [[ "$command" == *"$KUMA_IDLE_GUARD_MESSAGE"* ]]; then
    return 0
  fi

  prompt_file="$(printf '%s\n' "$command" | grep -oE -- '--append-system-prompt-file[[:space:]]+[^[:space:]]+' | awk '{print $2}' | tail -1 || true)"
  if [ -n "$prompt_file" ] && [ -f "$prompt_file" ]; then
    grep -F -- "$KUMA_IDLE_GUARD_MESSAGE" "$prompt_file" > /dev/null 2>&1
    return $?
  fi

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
      data.roleLabelKo || data.roleLabelEn || "",
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
  local identity_line spawn_context instructions

  identity_line="$(build_member_identity_line "$member_name")"
  spawn_context="$(build_spawn_context_instructions "$role_label_en" "$node_type")"
  instructions="$(cat <<EOF
${identity_line}
${spawn_context}
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
  local identity_line spawn_context instructions

  identity_line="$(build_member_identity_line "$member_name")"
  spawn_context="$(build_spawn_context_instructions "$role_label_en" "$node_type")"
  instructions="$(cat <<EOF
${identity_line}
${spawn_context}
$(build_idle_guard_message)
시작 문제가 없으면 응답하지 마.
EOF
)"

  printf '%s' "$instructions"
}

build_claude_prompt_file_path() {
  local prompt_kind="${1:-worker}"
  local member_name="${2:-}"
  local role_label_en="${3:-}"
  local node_type="${4:-worker}"
  local project_name="${5:-}"

  node --input-type=module - "$prompt_kind" "$member_name" "$role_label_en" "$node_type" "$project_name" <<'NODE'
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , promptKind = "", memberName = "", roleLabelEn = "", nodeType = "", projectName = ""] = process.argv;
const hash = createHash("sha256")
  .update(JSON.stringify({ promptKind, memberName, roleLabelEn, nodeType, projectName }))
  .digest("hex");

process.stdout.write(join(tmpdir(), "kuma-startup-prompts", `${hash}.txt`));
NODE
}

write_claude_prompt_file() {
  local prompt_kind="${1:-worker}"
  local prompt_text="${2:-}"
  local member_name="${3:-}"
  local role_label_en="${4:-}"
  local node_type="${5:-worker}"
  local project_name="${6:-}"
  local prompt_path

  prompt_path="$(build_claude_prompt_file_path "$prompt_kind" "$member_name" "$role_label_en" "$node_type" "$project_name")"
  mkdir -p "$(dirname "$prompt_path")"
  printf '%s' "$prompt_text" > "$prompt_path"
  printf '%s' "$prompt_path"
}

write_claude_startup_prompt_file() {
  local member_name="${1:-}"
  local role_label_en="${2:-}"
  local node_type="${3:-worker}"
  local project_name="${4:-}"
  local prompt_text

  prompt_text="$(build_claude_startup_system_prompt "$member_name" "$role_label_en" "$node_type" "$project_name")"
  write_claude_prompt_file "worker" "$prompt_text" "$member_name" "$role_label_en" "$node_type" "$project_name"
}

build_session_system_prompt() {
  local member_name="${1:-}"
  local role_label_en="${2:-}"
  local node_type="${3:-session}"
  local project_name="${4:-}"
  local identity_line spawn_context instructions

  if [ "$member_name" = "쿠마" ] && [ -f "$KUMA_SYSTEM_PROMPT_PATH" ]; then
    instructions="$(cat "$KUMA_SYSTEM_PROMPT_PATH")"
  else
    identity_line="$(build_member_identity_line "$member_name")"
    spawn_context="$(build_spawn_context_instructions "$role_label_en" "$node_type")"
    instructions="$(cat <<EOF
${identity_line}
${spawn_context}
EOF
)"
  fi

  printf '%s' "$instructions"
}

write_session_system_prompt_file() {
  local member_name="${1:-}"
  local role_label_en="${2:-}"
  local node_type="${3:-session}"
  local project_name="${4:-}"
  local prompt_text

  prompt_text="$(build_session_system_prompt "$member_name" "$role_label_en" "$node_type" "$project_name")"
  write_claude_prompt_file "session" "$prompt_text" "$member_name" "$role_label_en" "$node_type" "$project_name"
}

write_session_start_prompt_file() {
  local member_name="${1:-}"
  local role_label_en="${2:-}"
  local node_type="${3:-session}"
  local project_name="${4:-}"
  local prompt_text

  prompt_text="$(build_session_start_prompt "$member_name")"
  [ -n "$prompt_text" ] || return 0
  write_claude_prompt_file "session-start" "$prompt_text" "$member_name" "$role_label_en" "$node_type" "$project_name"
}

build_member_command_from_record() {
  local dir="$1"
  local record="${2:?launch record required}"
  local member_name type model options _emoji skill role_label_en node_type project_name developer_instructions developer_instructions_json startup_context_file command developer_instructions_setting display_label session_name_arg session_start_prompt_file session_channels
  IFS=$'\x1f' read -r member_name type model options _emoji skill role_label_en node_type <<< "$record"
  if [ "$node_type" = "session" ]; then
    project_name="$(resolve_project_name_from_dir "$KUMA_REPO_ROOT")"
  else
    project_name="$(resolve_project_name_from_dir "$dir")"
  fi

  case "$type" in
    claude)
      if [ "$node_type" = "session" ]; then
        startup_context_file="$(write_session_system_prompt_file "$member_name" "$role_label_en" "$node_type" "$project_name")"
        display_label="$(member_display_label_from_record "$member_name" "$record")"
        session_name_arg="$(shell_single_quote "$display_label")"
        session_start_prompt_file="$(write_session_start_prompt_file "$member_name" "$role_label_en" "$node_type" "$project_name")"
        session_channels=""
        if [ "$member_name" = "쿠마" ]; then
          session_channels=" --channels plugin:discord@claude-plugins-official"
        fi
        if [ -n "$session_start_prompt_file" ]; then
          printf -v command 'cd "%s" && exec claude --model %q %s%s --name %s --append-system-prompt-file %q "$(cat %q)"' "$dir" "$model" "$options" "$session_channels" "$session_name_arg" "$startup_context_file" "$session_start_prompt_file"
        else
          printf -v command 'cd "%s" && exec claude --model %q %s%s --name %s --append-system-prompt-file %q' "$dir" "$model" "$options" "$session_channels" "$session_name_arg" "$startup_context_file"
        fi
      else
        startup_context_file="$(write_claude_startup_prompt_file "$member_name" "$role_label_en" "$node_type" "$project_name")"
        printf -v command 'cd "%s" && KUMA_ROLE=worker claude --model %q %s --append-system-prompt-file %q' "$dir" "$model" "$options" "$startup_context_file"
      fi
      ;;
    codex)
      if [ "$node_type" = "session" ]; then
        developer_instructions="$(build_session_system_prompt "$member_name" "$role_label_en" "$node_type" "$project_name")"
      else
        developer_instructions="$(build_codex_developer_instructions "$member_name" "$role_label_en" "$node_type" "$project_name")"
      fi
      if [ -n "$developer_instructions" ]; then
        developer_instructions_json="$(json_stringify_string "$developer_instructions")"
        developer_instructions_setting="$(shell_single_quote "developer_instructions=$developer_instructions_json")"
        if [ "$node_type" = "session" ]; then
          printf -v command 'cd "%s" && exec codex -m %q %s -c %s' "$dir" "$model" "$options" "$developer_instructions_setting"
        else
          printf -v command 'cd "%s" && KUMA_ROLE=worker codex -m %q %s -c %s' "$dir" "$model" "$options" "$developer_instructions_setting"
        fi
      else
        if [ "$node_type" = "session" ]; then
          printf -v command 'cd "%s" && exec codex -m %q %s' "$dir" "$model" "$options"
        else
          printf -v command 'cd "%s" && KUMA_ROLE=worker codex -m %q %s' "$dir" "$model" "$options"
        fi
      fi
      ;;
    sonnet)
      if [ "$node_type" = "session" ]; then
        startup_context_file="$(write_session_system_prompt_file "$member_name" "$role_label_en" "$node_type" "$project_name")"
        display_label="$(member_display_label_from_record "$member_name" "$record")"
        session_name_arg="$(shell_single_quote "$display_label")"
        session_start_prompt_file="$(write_session_start_prompt_file "$member_name" "$role_label_en" "$node_type" "$project_name")"
        if [ -n "$session_start_prompt_file" ]; then
          printf -v command 'cd "%s" && exec claude --model sonnet --dangerously-skip-permissions --name %s --append-system-prompt-file %q "$(cat %q)"' "$dir" "$session_name_arg" "$startup_context_file" "$session_start_prompt_file"
        else
          printf -v command 'cd "%s" && exec claude --model sonnet --dangerously-skip-permissions --name %s --append-system-prompt-file %q' "$dir" "$session_name_arg" "$startup_context_file"
        fi
      else
        startup_context_file="$(write_claude_startup_prompt_file "$member_name" "$role_label_en" "$node_type" "$project_name")"
        printf -v command 'cd "%s" && KUMA_ROLE=worker claude --model sonnet --dangerously-skip-permissions --append-system-prompt-file %q' "$dir" "$startup_context_file"
      fi
      ;;
    *)
      echo "ERROR: Unknown type '$type'" >&2
      exit 1
      ;;
  esac

  if [ "$node_type" = "session" ]; then
    if startup_command_invokes_claude_skill "$command"; then
      echo "ERROR: Claude session command for ${member_name:-unknown} must not auto-run slash skills on spawn" >&2
      exit 1
    fi
  else
    assert_idle_safe_startup_command "$type" "$command" "${_name:-unknown}"
  fi
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
  local registry_path="${KUMA_SURFACES_PATH:-$HOME/.kuma/cmux/surfaces.json}"
  local member_json context_json

  member_json="$(team_config_get_member_json "$name" 2>/dev/null)" || return 1
  context_json="$(run_surface_registry_cli resolve-member-context "$registry_path" "$project" "$member_json" 2>/dev/null)" || return 1
  printf '%s' "$context_json" | node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); if (!data.surface) process.exit(1); process.stdout.write(`${data.surface}\n`);'
}
