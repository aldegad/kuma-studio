#!/bin/bash
# Usage: kuma (alias) or kuma-cmux-bootstrap.sh
# 쿠마 CTO 모드 전체 부트스트랩
# 순서: 팀 스폰(오른쪽) → 인프라(아래, 작게) → CTO 세션
# 팀을 먼저 오른쪽에 띄워야 인프라 down-split이 왼쪽 컬럼에만 적용됨
set -uo pipefail

SCRIPT_PATH="$(node -e 'const fs = require("node:fs"); const input = process.argv[1]; try { process.stdout.write(fs.realpathSync(input)); } catch { process.stdout.write(input); }' "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
KUMA_STUDIO_DIR="${KUMA_STUDIO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
BOOTSTRAP_CALLER_DIR="${INIT_CWD:-$(pwd -P)}"
WORKSPACE_DIR="${KUMA_STUDIO_WORKSPACE:-$BOOTSTRAP_CALLER_DIR}"
WORKSPACE_DIR="$(node -e 'const fs = require("node:fs"); const input = process.argv[1]; try { process.stdout.write(fs.realpathSync(input)); } catch { process.stdout.write(input); }' "$WORKSPACE_DIR")"
KUMA_SYSTEM_PROMPT_PATH="${KUMA_SYSTEM_PROMPT_PATH:-$KUMA_STUDIO_DIR/prompts/kuma-system-prompt.md}"
DEFAULT_EXPLORER_GLOBAL_ROOTS="vault,claude,codex"
if [ "${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS+x}" = x ]; then
  EXPLORER_GLOBAL_ROOTS_BINDING="${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS}"
else
  EXPLORER_GLOBAL_ROOTS_BINDING="${DEFAULT_EXPLORER_GLOBAL_ROOTS}"
fi

source "$SCRIPT_DIR/kuma-cmux-team-config.sh"
set -euo pipefail
require_team_config

REGISTRY="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"

# 헬퍼: surface → pane 조회
get_pane() {
  local surface="$1"
  resolve_surface_pane "$surface" "${CURRENT_WS:-}" 2>/dev/null || true
}

ensure_registry_file() {
  if [ ! -f "$REGISTRY" ]; then
    mkdir -p "$(dirname "$REGISTRY")"
    echo "{}" > "$REGISTRY"
  fi
}

extract_surface_title() {
  printf '%s\n' "$1" \
    | sed -E 's/^[*[:space:]]*surface:[0-9]+[[:space:]]+//' \
    | sed -E -e ':again' -e 's/[[:space:]]+\[[^]]+\][[:space:]]*$//' -e 't again' -e 's/[[:space:]]+$//'
}

normalize_title() {
  printf '%s\n' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

first_workspace_surface() {
  local workspace="$1"
  local panes_output pane_line pane_ref surfaces_output surface_ref

  panes_output="$(cmux list-panes --workspace "$workspace" 2>/dev/null || true)"
  while IFS= read -r pane_line; do
    pane_ref="$(printf '%s\n' "$pane_line" | grep -oE 'pane:[0-9]+' | head -1)"
    [ -n "$pane_ref" ] || continue
    surfaces_output="$(cmux list-pane-surfaces --workspace "$workspace" --pane "$pane_ref" 2>/dev/null || true)"
    surface_ref="$(printf '%s\n' "$surfaces_output" | grep -oE 'surface:[0-9]+' | head -1)"
    if [ -n "$surface_ref" ]; then
      printf '%s\n' "$surface_ref"
      return 0
    fi
  done <<< "$panes_output"

  return 1
}

find_surface_by_title_in_workspace() {
  local workspace="$1"
  local target_title normalized_target panes_output pane_line pane_ref surfaces_output surface_line surface_ref surface_title

  normalized_target="$(normalize_title "$2")"
  [ -n "$workspace" ] && [ -n "$normalized_target" ] || return 1

  panes_output="$(cmux list-panes --workspace "$workspace" 2>/dev/null || true)"
  while IFS= read -r pane_line; do
    pane_ref="$(printf '%s\n' "$pane_line" | grep -oE 'pane:[0-9]+' | head -1)"
    [ -n "$pane_ref" ] || continue

    surfaces_output="$(cmux list-pane-surfaces --workspace "$workspace" --pane "$pane_ref" 2>/dev/null || true)"
    while IFS= read -r surface_line; do
      surface_ref="$(printf '%s\n' "$surface_line" | grep -oE 'surface:[0-9]+' | head -1)"
      [ -n "$surface_ref" ] || continue
      surface_title="$(extract_surface_title "$surface_line")"
      if [ "$(normalize_title "$surface_title")" = "$normalized_target" ]; then
        printf '%s\n' "$surface_ref"
        return 0
      fi
    done <<< "$surfaces_output"
  done <<< "$panes_output"

  return 1
}

resolve_registered_label_surface() {
  local project="${1:?project required}"
  local label="${2:?label required}"

  node --input-type=module - "$REGISTRY" "$project" "$label" <<'NODE'
import { readFileSync } from "node:fs";

const [, , registryPath, projectId, label] = process.argv;

try {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const surface = registry?.[projectId]?.[label];
  if (typeof surface === "string" && surface.trim()) {
    process.stdout.write(`${surface.trim()}\n`);
  } else {
    process.exit(1);
  }
} catch {
  process.exit(1);
}
NODE
}

surface_alive() {
  local surface="${1:-}"
  [ -n "$surface" ] || return 1
  cmux read-screen --surface "$surface" --lines 1 > /dev/null 2>&1
}

resolve_bootstrap_surface() {
  local name="$1"
  local default_surface="$2"
  local existing_surface=""

  existing_surface="$(resolve_registered_member_surface "system" "$name" 2>/dev/null || true)"
  if surface_alive "$existing_surface"; then
    printf '%s\n' "$existing_surface"
    return 0
  fi

  if surface_alive "$default_surface"; then
    printf '%s\n' "$default_surface"
    return 0
  fi

  return 1
}

resolve_infra_surface() {
  local label="$1"
  local title="$2"
  local surface=""

  surface="$(resolve_registered_label_surface "kuma-studio" "$label" 2>/dev/null || true)"
  if surface_alive "$surface"; then
    printf '%s\n' "$surface"
    return 0
  fi

  surface="$(find_surface_by_title_in_workspace "$CURRENT_WS" "$title" 2>/dev/null || true)"
  if surface_alive "$surface"; then
    printf '%s\n' "$surface"
    return 0
  fi

  return 1
}

register_surface_label() {
  local project="$1"
  local label="$2"
  local surface="$3"
  local title="${4:-$label}"

  [ -n "$surface" ] || return 1
  cmux tab-action --action rename --workspace "$CURRENT_WS" --surface "$surface" --title "$title" > /dev/null 2>&1 || true
  "$SCRIPT_DIR/kuma-cmux-register.sh" "$project" "$label" "$surface" 2>/dev/null || true
}

ensure_system_member_surface() {
  local name="$1"
  local title default_surface surface startup_command result

  title="$(member_display_label "$name")"
  default_surface="$(team_config_get_member_field "$name" defaultSurface)"

  if [ "$name" = "쿠마" ]; then
    cmux tab-action --action rename --workspace "$CURRENT_WS" --surface "$KUMA_S" --title "$title" > /dev/null 2>&1 || true
    "$SCRIPT_DIR/kuma-cmux-register.sh" "system" "$title" "$KUMA_S" 2>/dev/null || true
    echo "✓ $title 이미 활성 ($KUMA_S)"
    return 0
  fi

  surface="$(resolve_bootstrap_surface "$name" "$default_surface" 2>/dev/null || true)"
  if [ -n "$surface" ]; then
    cmux tab-action --action rename --workspace "$CURRENT_WS" --surface "$surface" --title "$title" > /dev/null 2>&1 || true
    "$SCRIPT_DIR/kuma-cmux-register.sh" "system" "$title" "$surface" 2>/dev/null || true
    echo "✓ $title 이미 활성 ($surface)"
    return 0
  fi

  if [ -n "$default_surface" ]; then
    echo "  ↳ $title defaultSurface $default_surface 비활성, 새 system surface 할당"
  fi

  result="$(cmux new-surface --pane "$KUMA_P" --workspace "$CURRENT_WS" 2>&1 || true)"
  surface="$(echo "$result" | grep -oE 'surface:[0-9]+' | head -1 || true)"
  if [ -z "$surface" ]; then
    echo "✗ $title surface 생성 실패: $result"
    exit 1
  fi

  # System worker surfaces also boot into idle mode; dispatched work arrives later.
  startup_command="$(build_member_command "$name" "" "$WORKSPACE_DIR")"
  "$SCRIPT_DIR/kuma-cmux-send.sh" "$surface" "$startup_command" --workspace "$CURRENT_WS" > /dev/null
  cmux tab-action --action rename --workspace "$CURRENT_WS" --surface "$surface" --title "$title" > /dev/null 2>&1 || true
  "$SCRIPT_DIR/kuma-cmux-register.sh" "system" "$title" "$surface" 2>/dev/null || true
  echo "✓ $title 상주 탭 준비 완료 ($surface)"
}

echo "🐻 쿠마 스튜디오 부트스트랩"
echo "=========================="
echo ""

# 0. 레지스트리 보장 (부트스트랩은 기존 surface를 재사용해야 함)
ensure_registry_file

# 1. System 상주 탭 (CTO와 같은 pane)
CURRENT_WS="$(cmux tree 2>&1 | grep -oE 'workspace:[0-9]+' | head -1 || true)"
if [ -z "$CURRENT_WS" ]; then
  echo "✗ 현재 워크스페이스 조회 실패"
  exit 1
fi

echo "→ system 상주 탭 준비 중..."
KUMA_S="$(team_config_get_member_field "쿠마" defaultSurface)"
[ -n "$KUMA_S" ] || KUMA_S="surface:1"
KUMA_P=$(get_pane "$KUMA_S")
if [ -z "$KUMA_P" ]; then
  # Fresh session: fall back to the first surface inside the current workspace only.
  KUMA_S="$(first_workspace_surface "$CURRENT_WS" 2>/dev/null || true)"
  KUMA_P="$(get_pane "$KUMA_S")"
  if [ -z "$KUMA_P" ]; then
    echo "✗ 쿠마 pane 조회 실패"
    exit 1
  fi
  echo "  ↳ 기존 surface 없음, 현재 pane 사용 ($KUMA_P / $KUMA_S)"
fi
while IFS= read -r SYSTEM_MEMBER; do
  [ -n "$SYSTEM_MEMBER" ] || continue
  ensure_system_member_surface "$SYSTEM_MEMBER"
done < <(list_bootstrap_system_members)

# 2. 팀 스폰 (셸 스크립트, 토큰 0) — CTO 우측에 배치
echo "→ 팀 스폰 중..."
"$SCRIPT_DIR/kuma-cmux-project-init.sh" "kuma-studio" "$KUMA_STUDIO_DIR" --workspace "$CURRENT_WS"

# 3. 인프라 pane (서버 + 프론트를 탭으로, 아래에 작게)
SERVER_ALIVE=false
FRONT_ALIVE=false
curl -sf http://localhost:4312/health > /dev/null 2>&1 && SERVER_ALIVE=true
curl -sf http://localhost:5173/studio/ > /dev/null 2>&1 && FRONT_ALIVE=true

SERVER_SURFACE="$(resolve_infra_surface "server" "kuma-server" 2>/dev/null || true)"
FRONT_SURFACE="$(resolve_infra_surface "frontend" "kuma-frontend" 2>/dev/null || true)"
[ -n "$SERVER_SURFACE" ] && register_surface_label "kuma-studio" "server" "$SERVER_SURFACE" "kuma-server"
[ -n "$FRONT_SURFACE" ] && register_surface_label "kuma-studio" "frontend" "$FRONT_SURFACE" "kuma-frontend"

INFRA_P=""
if [ -n "$SERVER_SURFACE" ]; then
  INFRA_P="$(get_pane "$SERVER_SURFACE")"
elif [ -n "$FRONT_SURFACE" ]; then
  INFRA_P="$(get_pane "$FRONT_SURFACE")"
fi

if $SERVER_ALIVE && $FRONT_ALIVE; then
  echo "✓ 서버/프론트 이미 실행 중"
else
  if ! $SERVER_ALIVE; then
    STALE_PID="$(lsof -i :4312 -t 2>/dev/null || true)"
    [ -n "$STALE_PID" ] && kill "$STALE_PID" 2>/dev/null && sleep 1

    if [ -z "$SERVER_SURFACE" ]; then
      if [ -n "$INFRA_P" ]; then
        RESULT="$(cmux new-surface --pane "$INFRA_P" --workspace "$CURRENT_WS" 2>&1 || true)"
      else
        RESULT="$(cmux new-split down --workspace "$CURRENT_WS" 2>&1 || true)"
      fi
      SERVER_SURFACE="$(echo "$RESULT" | grep -oE 'surface:[0-9]+' | head -1 || true)"
      if [ -z "$SERVER_SURFACE" ]; then
        echo "✗ 서버 surface 생성 실패: $RESULT"
        exit 1
      fi
    fi

    INFRA_P="$(get_pane "$SERVER_SURFACE")"
    echo "→ 쿠마 서버 시작 중..."
    if [ -n "${KUMA_STUDIO_WORKSPACE:-}" ] || [ "$WORKSPACE_DIR" != "$KUMA_STUDIO_DIR" ]; then
      printf -v SERVER_START_COMMAND 'cd "%s" && KUMA_STUDIO_WORKSPACE=%q KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=%q npm run server:reload' "$KUMA_STUDIO_DIR" "$WORKSPACE_DIR" "$EXPLORER_GLOBAL_ROOTS_BINDING"
    else
      printf -v SERVER_START_COMMAND 'cd "%s" && KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=%q npm run server:reload' "$KUMA_STUDIO_DIR" "$EXPLORER_GLOBAL_ROOTS_BINDING"
    fi
    "$SCRIPT_DIR/kuma-cmux-send.sh" "$SERVER_SURFACE" "$SERVER_START_COMMAND" > /dev/null
    register_surface_label "kuma-studio" "server" "$SERVER_SURFACE" "kuma-server"

    echo -n "  기동 대기"
    SERVER_OK=false
    for i in $(seq 1 30); do
      curl -sf http://localhost:4312/health > /dev/null 2>&1 && SERVER_OK=true && break
      echo -n "."; sleep 1
    done
    echo ""
    if $SERVER_OK; then
      echo "✓ 쿠마 서버 정상 기동 ($SERVER_SURFACE)"
    else
      echo "✗ 쿠마 서버 기동 실패"
      cmux read-screen --surface "$SERVER_SURFACE" --lines 15 2>/dev/null || true
      exit 1
    fi
  fi

  if [ -z "$INFRA_P" ] && [ -n "$SERVER_SURFACE" ]; then
    INFRA_P="$(get_pane "$SERVER_SURFACE")"
  fi
  if [ -z "$INFRA_P" ] && [ -n "$FRONT_SURFACE" ]; then
    INFRA_P="$(get_pane "$FRONT_SURFACE")"
  fi

  if ! $FRONT_ALIVE; then
    STALE_PID="$(lsof -i :5173 -t 2>/dev/null || true)"
    [ -n "$STALE_PID" ] && kill "$STALE_PID" 2>/dev/null && sleep 1

    if [ -z "$FRONT_SURFACE" ]; then
      if [ -n "$INFRA_P" ]; then
        FR="$(cmux new-surface --pane "$INFRA_P" --workspace "$CURRENT_WS" 2>&1 || true)"
      else
        FR="$(cmux new-split down --workspace "$CURRENT_WS" 2>&1 || true)"
      fi
      FRONT_SURFACE="$(echo "$FR" | grep -oE 'surface:[0-9]+' | head -1 || true)"
      if [ -z "$FRONT_SURFACE" ]; then
        echo "✗ 프론트 surface 생성 실패: $FR"
        exit 1
      fi
    fi

    [ -n "$INFRA_P" ] || INFRA_P="$(get_pane "$FRONT_SURFACE")"
    echo "→ 스튜디오 프론트 시작 중..."
    "$SCRIPT_DIR/kuma-cmux-send.sh" "$FRONT_SURFACE" "cd \"$KUMA_STUDIO_DIR\" && npm run dev:studio" > /dev/null
    register_surface_label "kuma-studio" "frontend" "$FRONT_SURFACE" "kuma-frontend"

    echo -n "  기동 대기"
    FRONT_OK=false
    for i in $(seq 1 30); do
      curl -sf http://localhost:5173/studio/ > /dev/null 2>&1 && FRONT_OK=true && break
      echo -n "."; sleep 1
    done
    echo ""
    if $FRONT_OK; then
      echo "✓ 스튜디오 프론트 정상 기동 ($FRONT_SURFACE)"
    else
      echo "✗ 스튜디오 프론트 기동 실패"
      cmux read-screen --surface "$FRONT_SURFACE" --lines 15 2>/dev/null || true
      exit 1
    fi
  fi

  [ -n "$INFRA_P" ] && cmux resize-pane --pane "$INFRA_P" -U --amount 15 > /dev/null 2>&1 || true
fi

# 4. 워크스페이스 + CTO 탭 이름 설정
cmux workspace-action --action rename --title "🐻 kuma studio" > /dev/null 2>&1 || true
cmux tab-action --action rename --surface "$KUMA_S" --title "🐻 쿠마" > /dev/null 2>&1 || true
/usr/bin/open -a 'Google Chrome' http://localhost:5173/studio/

echo ""
echo "=========================="
echo "🐻 쿠마 스튜디오 준비 완료!"
echo ""
echo "스튜디오: http://localhost:5173/studio/"
echo "서버 API: http://localhost:4312"
echo ""
echo "→ 쿠마 CTO 세션 시작..."
cd "$WORKSPACE_DIR"
KUMA_SYSTEM_PROMPT="$(cat "$KUMA_SYSTEM_PROMPT_PATH")"
KUMA_DECISIONS_BOOT_PACK="$(build_decisions_boot_pack_prompt)"
if [ -n "$KUMA_DECISIONS_BOOT_PACK" ]; then
  KUMA_SYSTEM_PROMPT="${KUMA_SYSTEM_PROMPT}

${KUMA_DECISIONS_BOOT_PACK}"
fi
KUMA_BOOTSTRAP_BRIEF_PROMPT="$(cat <<'EOF'
쿠마 모드로 부트스트랩 직후 첫 브리핑을 시작해줘.

첫 응답에서는 지금 워크스페이스 기준으로 아래만 짧고 운영자답게 정리해:
- managed infra 상태: kuma-server / kuma-frontend
- 팀 멤버 상태 요약: idle / working
- 최근 커밋 1개와 현재 워크트리 변경 요약
- 마지막 한 줄: 지금 무엇을 시킬지 묻기

바로 브리핑부터 시작해.
EOF
)"
exec claude \
  --dangerously-skip-permissions \
  --channels plugin:discord@claude-plugins-official \
  --name "🐻 쿠마" \
  --append-system-prompt "$KUMA_SYSTEM_PROMPT" \
  "$KUMA_BOOTSTRAP_BRIEF_PROMPT"
