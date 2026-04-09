#!/bin/bash
# Usage: kuma-cmux-project-init.sh <project> <dir> [--workspace <ws-id>]
# --workspace: 기존 워크스페이스에 right split으로 배치 (bootstrap용)
# 생략 시: 새 워크스페이스(탭) 생성 (추가 프로젝트용)
# Layout: 팀 리더/워커 탭 수는 `team.json`에서 동적으로 계산
#         시스템 팀은 공용 surface를 유지하고, 프로젝트 워커는 dev/strategy-analytics를 배치
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

REGISTRY="/tmp/kuma-surfaces.json"

if [ ! -f "$REGISTRY" ]; then
  echo "{}" > "$REGISTRY"
fi

# 전원 살아있으면 스킵
ALL_ALIVE=true
for name in $(list_spawn_members); do
  LABEL="$(member_display_label "$name")"
  EXISTING=$(jq -r --arg p "$PROJECT" --arg n "$name" --arg l "$LABEL" '.[$p][$l] // .[$p][$n] // empty' "$REGISTRY" 2>/dev/null || echo "")
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

resolve_strategy_analytics_team() {
  local candidate
  for candidate in strategy-analytics analytics strategy; do
    if [ -n "$(list_team_members "$candidate" | head -1)" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf '%s\n' "strategy-analytics"
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

# --- 개발팀 (첫 pane) ---
DEV_LEAD="$(list_team_members dev team | head -1)"
start_session "$FIRST_S" "$DEV_LEAD" "$WS_ID"

while IFS= read -r NAME; do
  [ -n "$NAME" ] || continue
  R=$(cmux new-surface --pane "$FIRST_P" --workspace "$WS_ID" 2>&1)
  S=$(echo "$R" | grep -oE 'surface:[0-9]+')
  sleep 1
  start_session "$S" "$NAME" "$WS_ID"
done < <(list_team_members dev worker)

# --- 전략분석팀 pane (right split) ---
STRATEGY_ANALYTICS_TEAM="$(resolve_strategy_analytics_team)"
R2=$(cmux new-split right --surface "$FIRST_S" --workspace "$WS_ID" 2>&1)
STRAT_S=$(echo "$R2" | grep -oE 'surface:[0-9]+')
STRAT_P=$(get_pane "$STRAT_S")
sleep 1
STRAT_LEAD="$(list_team_members "$STRATEGY_ANALYTICS_TEAM" team | head -1)"
start_session "$STRAT_S" "$STRAT_LEAD" "$WS_ID"

while IFS= read -r NAME; do
  [ -n "$NAME" ] || continue
  R=$(cmux new-surface --pane "$STRAT_P" --workspace "$WS_ID" 2>&1)
  S=$(echo "$R" | grep -oE 'surface:[0-9]+')
  sleep 1
  start_session "$S" "$NAME" "$WS_ID"
done < <(list_team_members "$STRATEGY_ANALYTICS_TEAM" worker)

echo ""
echo "전팀 준비 완료. (워크스페이스: $WS_ID)"
