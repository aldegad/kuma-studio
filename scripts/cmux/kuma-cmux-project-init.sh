#!/bin/bash
# Usage: kuma-cmux-project-init.sh <project> <dir> [--workspace <ws-id>]
# --workspace: 기존 워크스페이스에 right split으로 배치 (bootstrap용)
# 생략 시: 새 워크스페이스(탭) 생성 (추가 프로젝트용)
# Layout: 팀 리더/워커 탭 수와 팀 컬럼 수는 `team.json` active non-system teams 기준으로 동적 계산
#         시스템 팀은 공용 surface를 유지하고, 프로젝트 팀 컬럼은 canonical team order 그대로 배치
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/kuma-cmux-team-config.sh"
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

# 전원 살아있으면 스킵
ALL_ALIVE=true
for name in $(list_project_spawn_members); do
  EXISTING="$(resolve_registered_member_surface "$PROJECT" "$name" 2>/dev/null || true)"
  if [ -z "$EXISTING" ] || ! cmux read-screen --surface "$EXISTING" --lines 1 > /dev/null 2>&1; then
    ALL_ALIVE=false
    break
  fi
done
if [ "$ALL_ALIVE" = true ]; then
  echo "✓ 전원 이미 활성"
  exit 0
fi

# 헬퍼: surface → pane 조회
get_pane() {
  local surface="$1"
  cmux tree 2>&1 | grep -B5 "$surface" | grep -oE 'pane:[0-9]+' | tail -1
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

    result=$(cmux new-surface --pane "$lead_pane" --workspace "$WS_ID" 2>&1)
    surface=$(echo "$result" | grep -oE 'surface:[0-9]+')
    sleep 1
    start_session "$surface" "$worker_name" "$WS_ID"
  done < <(list_team_members "$team_id" worker)
}

# --- 워크스페이스 확보 ---
if [ -n "$EXISTING_WS" ]; then
  # 기존 워크스페이스에 right split으로 팀 pane 생성
  WS_ID="$EXISTING_WS"
  SPLIT_RESULT=$(cmux new-split right --workspace "$WS_ID" 2>&1)
  FIRST_S=$(echo "$SPLIT_RESULT" | grep -oE 'surface:[0-9]+')
  if [ -z "$FIRST_S" ]; then
    echo "✗ 팀 pane 생성 실패: $SPLIT_RESULT"
    exit 1
  fi
else
  # 새 워크스페이스(탭) 생성
  WS_RESULT=$(cmux new-workspace --name "$PROJECT" --cwd "$DIR" 2>&1)
  WS_ID=$(echo "$WS_RESULT" | grep -oE 'workspace:[0-9]+')
  if [ -z "$WS_ID" ]; then
    echo "✗ 워크스페이스 생성 실패: $WS_RESULT"
    exit 1
  fi
  # new-workspace 출력에 surface가 ���을 수 있으므로 tree에서 조회
  FIRST_S=$(echo "$WS_RESULT" | grep -oE 'surface:[0-9]+')
  if [ -z "$FIRST_S" ]; then
    FIRST_S=$(cmux tree 2>&1 | grep -A5 "$WS_ID" | grep -oE 'surface:[0-9]+' | head -1)
  fi
  if [ -z "$FIRST_S" ]; then
    echo "✗ 워크스페이스 surface 조회 실패"
    exit 1
  fi
fi

FIRST_P=$(get_pane "$FIRST_S")
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
    SPLIT_RESULT=$(cmux new-split right --surface "$CURRENT_TEAM_SURFACE" --workspace "$WS_ID" 2>&1)
    CURRENT_TEAM_SURFACE=$(echo "$SPLIT_RESULT" | grep -oE 'surface:[0-9]+')
    CURRENT_TEAM_PANE=$(get_pane "$CURRENT_TEAM_SURFACE")
    sleep 1
  fi

  start_team_column "$TEAM_ID" "$CURRENT_TEAM_SURFACE" "$CURRENT_TEAM_PANE"
done

echo ""
echo "전팀 준비 완료. (워크스페이스: $WS_ID)"
