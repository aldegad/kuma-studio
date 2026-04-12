#!/bin/bash
# Usage: kuma-cmux-project-init.sh <project> <dir> [--workspace <ws-id>]
# --workspace: 기존 워크스페이스에 right split으로 배치 (bootstrap용)
# 생략 시: 새 워크스페이스(탭) 생성 (추가 프로젝트용)
# Layout: 팀 리더/워커 탭 수와 팀 컬럼 수는 `team.json` active non-system teams 기준으로 동적 계산
#         시스템 팀은 공용 surface를 유지하고, 프로젝트 팀 컬럼은 canonical team order 그대로 배치
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/kuma-cmux-team-config.sh"
set -euo pipefail
require_team_config

PROJECT="${1:?project name required}"
DIR="${2:?directory required}"
shift 2

# Parse optional flags
EXISTING_WS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace) EXISTING_WS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

REGISTRY="${KUMA_SURFACES_PATH:-/tmp/kuma-surfaces.json}"

if [ ! -f "$REGISTRY" ]; then
  echo "{}" > "$REGISTRY"
fi

# 전원 살아있으면 스킵, 일부만 살아있으면 중복 스폰 방지를 위해 실패
ACTIVE_COUNT=0
TOTAL_COUNT=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  EXISTING="$(resolve_registered_member_surface "$PROJECT" "$name" 2>/dev/null || true)"
  if [ -n "$EXISTING" ] && cmux read-screen --surface "$EXISTING" --lines 1 > /dev/null 2>&1; then
    ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
  fi
done < <(list_project_spawn_members)

if [ "$TOTAL_COUNT" -gt 0 ] && [ "$ACTIVE_COUNT" -eq "$TOTAL_COUNT" ]; then
  echo "✓ 전원 이미 활성"
  exit 0
fi

if [ "$ACTIVE_COUNT" -gt 0 ]; then
  echo "✗ 프로젝트 일부만 활성 상태입니다 ($ACTIVE_COUNT/$TOTAL_COUNT). 중복 스폰 방지를 위해 초기화를 중단합니다." >&2
  echo "  먼저 ~/.kuma/cmux/kuma-cmux-clean.sh 로 꼬인 surface 를 정리한 뒤 다시 실행하세요." >&2
  exit 1
fi

# 헬퍼: surface → pane 조회
get_pane() {
  local surface="$1"
  resolve_surface_pane "$surface" "${WS_ID:-}" 2>/dev/null || true
}

# 헬퍼: surface에 세션 시작 + 등록 + 타이틀
start_session() {
  local SURFACE="$1" NAME="$2" WORKSPACE="$3"
  local TITLE COMMAND
  TITLE="$(member_display_label "$NAME")"
  COMMAND="$(build_member_command "$NAME" "" "$DIR")"

  "$SCRIPT_DIR/kuma-cmux-send.sh" "$SURFACE" "$COMMAND" --workspace "$WORKSPACE" > /dev/null

  cmux tab-action --action rename --workspace "$WORKSPACE" --surface "$SURFACE" --title "$TITLE" > /dev/null 2>&1
  "$SCRIPT_DIR/kuma-cmux-register.sh" "$PROJECT" "$TITLE" "$SURFACE" || true
  echo "✓ $TITLE — $SURFACE" >&2
}

start_team_column() {
  local team_id="$1"
  local lead_surface="$2"
  local lead_pane="$3"
  local team_lead=""
  local worker_name=""
  local result=""
  local surface=""

  team_lead="$(list_team_members "$team_id" team | head -1)"
  if [ -z "$team_lead" ]; then
    team_lead="$(list_team_members "$team_id" worker | head -1)"
  fi

  if [ -z "$team_lead" ]; then
    echo "✗ team '$team_id' has no spawnable members"
    exit 1
  fi

  start_session "$lead_surface" "$team_lead" "$WS_ID"

  while IFS= read -r worker_name; do
    [ -n "$worker_name" ] || continue
    if [ "$worker_name" = "$team_lead" ]; then
      continue
    fi

    result="$(cmux new-surface --pane "$lead_pane" --workspace "$WS_ID" 2>&1 || true)"
    surface="$(echo "$result" | grep -oE 'surface:[0-9]+' | head -1 || true)"
    if [ -z "$surface" ]; then
      echo "✗ worker surface 생성 실패: $result"
      exit 1
    fi
    sleep 1
    start_session "$surface" "$worker_name" "$WS_ID"
  done < <(list_team_members "$team_id" worker)
}

# --- 워크스페이스 확보 ---
if [ -n "$EXISTING_WS" ]; then
  # 기존 워크스페이스에 right split으로 팀 pane 생성
  WS_ID="$EXISTING_WS"
  SPLIT_RESULT="$(cmux new-split right --workspace "$WS_ID" 2>&1 || true)"
  FIRST_S="$(echo "$SPLIT_RESULT" | grep -oE 'surface:[0-9]+' | head -1 || true)"
  if [ -z "$FIRST_S" ]; then
    echo "✗ 팀 pane 생성 실패: $SPLIT_RESULT"
    exit 1
  fi
else
  # 새 워크스페이스(탭) 생성
  WS_RESULT="$(cmux new-workspace --name "$PROJECT" --cwd "$DIR" 2>&1 || true)"
  WS_ID="$(echo "$WS_RESULT" | grep -oE 'workspace:[0-9]+' | head -1 || true)"
  if [ -z "$WS_ID" ]; then
    echo "✗ 워크스페이스 생성 실패: $WS_RESULT"
    exit 1
  fi
  # new-workspace 출력에 surface가 ���을 수 있으므로 tree에서 조회
  FIRST_S="$(echo "$WS_RESULT" | grep -oE 'surface:[0-9]+' | head -1 || true)"
  if [ -z "$FIRST_S" ]; then
    FIRST_S="$(cmux tree 2>&1 | grep -A5 "$WS_ID" | grep -oE 'surface:[0-9]+' | head -1 || true)"
  fi
  if [ -z "$FIRST_S" ]; then
    echo "✗ 워크스페이스 surface 조회 실패"
    exit 1
  fi
fi

FIRST_P=$(get_pane "$FIRST_S")
if [ -z "$FIRST_P" ]; then
  echo "✗ 팀 pane 조회 실패"
  exit 1
fi
sleep 1

PROJECT_TEAMS=()
while IFS= read -r TEAM_ID; do
  [ -n "$TEAM_ID" ] || continue
  PROJECT_TEAMS+=("$TEAM_ID")
done < <(list_project_spawn_teams)

if [ "${#PROJECT_TEAMS[@]}" -eq 0 ]; then
  echo "✗ active project teams not found in team.json"
  exit 1
fi

# --- 프로젝트 팀 컬럼들 (canonical team order) ---
CURRENT_TEAM_SURFACE="$FIRST_S"
CURRENT_TEAM_PANE="$FIRST_P"

for INDEX in "${!PROJECT_TEAMS[@]}"; do
  TEAM_ID="${PROJECT_TEAMS[$INDEX]}"

  if [ "$INDEX" -gt 0 ]; then
    SPLIT_RESULT="$(cmux new-split right --surface "$CURRENT_TEAM_SURFACE" --workspace "$WS_ID" 2>&1 || true)"
    CURRENT_TEAM_SURFACE="$(echo "$SPLIT_RESULT" | grep -oE 'surface:[0-9]+' | head -1 || true)"
    if [ -z "$CURRENT_TEAM_SURFACE" ]; then
      echo "✗ 팀 컬럼 생성 실패: $SPLIT_RESULT"
      exit 1
    fi
    CURRENT_TEAM_PANE="$(get_pane "$CURRENT_TEAM_SURFACE")"
    if [ -z "$CURRENT_TEAM_PANE" ]; then
      echo "✗ 팀 컬럼 pane 조회 실패 ($CURRENT_TEAM_SURFACE)"
      exit 1
    fi
    sleep 1
  fi

  start_team_column "$TEAM_ID" "$CURRENT_TEAM_SURFACE" "$CURRENT_TEAM_PANE"
done

echo ""
echo "전팀 준비 완료. (워크스페이스: $WS_ID)"
