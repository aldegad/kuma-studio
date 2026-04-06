#!/bin/bash
# Usage: kuma-cmux-project-init.sh <project> <dir> [--workspace <ws-id>]
# --workspace: 기존 워크스페이스에 right split으로 배치 (bootstrap용)
# 생략 시: 새 워크스페이스(탭) 생성 (추가 프로젝트용)
# Layout: 개발팀(5tabs) | 분석팀(3tabs)
#                        | 전략팀(3tabs)
set -uo pipefail

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="/tmp/kuma-surfaces.json"

if [ ! -f "$REGISTRY" ]; then
  echo "{}" > "$REGISTRY"
fi

# 전원 살아있으면 스킵
ALL_ALIVE=true
for name in 하울 쿤 뚝딱이 새미 밤토리 루미 다람이 부리 노을이 콩콩이 뭉치; do
  EXISTING=$(jq -r --arg p "$PROJECT" --arg n "$name" '.[$p][$n] // empty' "$REGISTRY" 2>/dev/null || echo "")
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
  local SURFACE="$1" NAME="$2" TYPE="$3" WORKSPACE="$4"
  local SEND_ARGS=(--workspace "$WORKSPACE" --surface "$SURFACE")

  case "$TYPE" in
    claude)  cmux send "${SEND_ARGS[@]}" "cd \"$DIR\" && KUMA_ROLE=worker claude --dangerously-skip-permissions" > /dev/null
             cmux send-key "${SEND_ARGS[@]}" Enter > /dev/null ;;
    codex)   cmux send "${SEND_ARGS[@]}" "cd \"$DIR\" && KUMA_ROLE=worker codex --dangerously-bypass-approvals-and-sandbox -m gpt-5.4 -c service_tier=fast" > /dev/null
             cmux send-key "${SEND_ARGS[@]}" Enter > /dev/null ;;
    sonnet)  cmux send "${SEND_ARGS[@]}" "cd \"$DIR\" && KUMA_ROLE=worker claude --model sonnet --dangerously-skip-permissions" > /dev/null
             cmux send-key "${SEND_ARGS[@]}" Enter > /dev/null ;;
  esac

  cmux tab-action --action rename --workspace "$WORKSPACE" --surface "$SURFACE" --title "$NAME" > /dev/null 2>&1
  "$SCRIPT_DIR/kuma-cmux-register.sh" "$PROJECT" "$NAME" "$SURFACE" || true
  echo "✓ $NAME — $SURFACE" >&2
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

# --- 개발팀 (첫 pane, 5 tabs) ---
start_session "$FIRST_S" "🐺 하울" "claude" "$WS_ID"

for pair in "🦝 쿤:claude" "🦫 뚝딱이:codex" "🦅 새미:codex" "🦔 밤토리:claude"; do
  NAME="${pair%%:*}"; TYPE="${pair#*:}"
  R=$(cmux new-surface --pane "$FIRST_P" --workspace "$WS_ID" 2>&1)
  S=$(echo "$R" | grep -oE 'surface:[0-9]+')
  sleep 1
  start_session "$S" "$NAME" "$TYPE" "$WS_ID"
done

# --- 분석팀 pane (right split, 3 tabs) ---
R2=$(cmux new-split right --surface "$FIRST_S" --workspace "$WS_ID" 2>&1)
ANA_S=$(echo "$R2" | grep -oE 'surface:[0-9]+')
ANA_P=$(get_pane "$ANA_S")
sleep 1
start_session "$ANA_S" "🦊 루미" "claude" "$WS_ID"

for pair in "🐿 다람이:codex" "🦉 부리:sonnet"; do
  NAME="${pair%%:*}"; TYPE="${pair#*:}"
  R=$(cmux new-surface --pane "$ANA_P" --workspace "$WS_ID" 2>&1)
  S=$(echo "$R" | grep -oE 'surface:[0-9]+')
  sleep 1
  start_session "$S" "$NAME" "$TYPE" "$WS_ID"
done

# --- 전략팀 pane (down split from 분석팀, 3 tabs) ---
R3=$(cmux new-split down --surface "$ANA_S" --workspace "$WS_ID" 2>&1)
STR_S=$(echo "$R3" | grep -oE 'surface:[0-9]+')
STR_P=$(get_pane "$STR_S")
sleep 1
start_session "$STR_S" "🦌 노을이" "claude" "$WS_ID"

for pair in "🐰 콩콩이:claude" "🐹 뭉치:claude"; do
  NAME="${pair%%:*}"; TYPE="${pair#*:}"
  R=$(cmux new-surface --pane "$STR_P" --workspace "$WS_ID" 2>&1)
  S=$(echo "$R" | grep -oE 'surface:[0-9]+')
  sleep 1
  start_session "$S" "$NAME" "$TYPE" "$WS_ID"
done

echo ""
echo "전팀 준비 완료. (워크스페이스: $WS_ID)"
