#!/bin/bash
# Usage: kuma (alias) or kuma-cmux-bootstrap.sh
# 쿠마 CTO 모드 전체 부트스트랩
# 순서: 팀 스폰(오른쪽) → 인프라(아래, 작게) → CTO 세션
# 팀을 먼저 오른쪽에 띄워야 인프라 down-split이 왼쪽 컬럼에만 적용됨
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUMA_STUDIO_DIR="/workspace/kuma-studio"
WORKSPACE_DIR="/workspace"

# 헬퍼: surface → pane 조회
get_pane() {
  local surface="$1"
  cmux tree 2>&1 | grep -B5 "$surface" | grep -oE 'pane:[0-9]+' | tail -1
}

echo "🐻 쿠마 스튜디오 부트스트랩"
echo "=========================="
echo ""

# 1. 쭈니 상주 탭 (CTO와 같은 pane)
CURRENT_WS=$(cmux tree 2>&1 | grep -oE 'workspace:[0-9]+' | head -1)
if [ -z "$CURRENT_WS" ]; then
  echo "✗ 현재 워크스페이스 조회 실패"
  exit 1
fi

echo "→ 쭈니 상주 탭 준비 중..."
KUMA_S="surface:1"
KUMA_P=$(get_pane "$KUMA_S")
if [ -z "$KUMA_P" ]; then
  echo "✗ 쿠마 pane 조회 실패"
  exit 1
fi
"$SCRIPT_DIR/kuma-cmux-register.sh" "system" "🐻 쿠마" "$KUMA_S" 2>/dev/null || true

JOONI_S=$(jq -r '.system["쭈니"] // empty' /tmp/kuma-surfaces.json 2>/dev/null || echo "")
JOONI_READY=false

if [ -n "$JOONI_S" ] && cmux read-screen --surface "$JOONI_S" --lines 1 > /dev/null 2>&1; then
  JOONI_P=$(get_pane "$JOONI_S")
  if [ -n "$JOONI_P" ] && [ "$JOONI_P" = "$KUMA_P" ]; then
    JOONI_READY=true
  fi
fi

if $JOONI_READY; then
  cmux tab-action --action rename --workspace "$CURRENT_WS" --surface "$JOONI_S" --title "🐝 쭈니" > /dev/null 2>&1 || true
  "$SCRIPT_DIR/kuma-cmux-register.sh" "system" "쭈니" "$JOONI_S" 2>/dev/null || true
  echo "✓ 쭈니 이미 활성 ($JOONI_S)"
else
  JR=$(cmux new-surface --pane "$KUMA_P" --workspace "$CURRENT_WS" 2>&1)
  JOONI_S=$(echo "$JR" | grep -oE 'surface:[0-9]+')
  if [ -z "$JOONI_S" ]; then
    echo "✗ 쭈니 surface 생성 실패: $JR"
    exit 1
  fi

  JOONI_P=$(get_pane "$JOONI_S")
  if [ -z "$JOONI_P" ] || [ "$JOONI_P" != "$KUMA_P" ]; then
    echo "✗ 쭈니 pane 배치 실패"
    exit 1
  fi

  "$SCRIPT_DIR/kuma-cmux-send.sh" "$JOONI_S" \
    "cd \"$WORKSPACE_DIR\" && KUMA_ROLE=worker codex --dangerously-bypass-approvals-and-sandbox -m gpt-5.4 -c service_tier=fast -c model_reasoning_effort=\"xhigh\"" \
    --workspace "$CURRENT_WS" \
    > /dev/null
  cmux tab-action --action rename --workspace "$CURRENT_WS" --surface "$JOONI_S" --title "🐝 쭈니" > /dev/null 2>&1 || true
  "$SCRIPT_DIR/kuma-cmux-register.sh" "system" "쭈니" "$JOONI_S" 2>/dev/null || true
  echo "✓ 쭈니 상주 탭 준비 완료 ($JOONI_S)"
fi

# 2. 팀 스폰 (셸 스크립트, 토큰 0) — CTO 우측에 배치
echo "→ 팀 스폰 중..."
"$SCRIPT_DIR/kuma-cmux-project-init.sh" "kuma-studio" "$KUMA_STUDIO_DIR" --workspace "$CURRENT_WS"

# 3. 인프라 pane (서버 + 프론트를 탭으로, 아래에 작게)
SERVER_ALIVE=false
FRONT_ALIVE=false
curl -sf http://localhost:4312/health > /dev/null 2>&1 && SERVER_ALIVE=true
curl -sf http://localhost:5173/studio/ > /dev/null 2>&1 && FRONT_ALIVE=true

if $SERVER_ALIVE && $FRONT_ALIVE; then
  echo "✓ 서버/프론트 이미 실행 중"
else
  # 인프라 pane 생성 (아래)
  RESULT=$(cmux new-split down 2>&1) || true
  INFRA_S=$(echo "$RESULT" | grep -oE 'surface:[0-9]+')
  INFRA_P=$(get_pane "$INFRA_S")

  if [ -n "$INFRA_S" ]; then
    # 서버 시작
    if ! $SERVER_ALIVE; then
      STALE_PID=$(lsof -i :4312 -t 2>/dev/null)
      [ -n "$STALE_PID" ] && kill "$STALE_PID" 2>/dev/null && sleep 1
      echo "→ 쿠마 서버 시작 중..."
      "$SCRIPT_DIR/kuma-cmux-send.sh" "$INFRA_S" "cd \"$KUMA_STUDIO_DIR\" && npm run server:reload" > /dev/null
      cmux tab-action --action rename --surface "$INFRA_S" --title "kuma-server" > /dev/null 2>&1
      "$SCRIPT_DIR/kuma-cmux-register.sh" "kuma-studio" "server" "$INFRA_S" 2>/dev/null || true

      echo -n "  기동 대기"
      SERVER_OK=false
      for i in $(seq 1 30); do
        curl -sf http://localhost:4312/health > /dev/null 2>&1 && SERVER_OK=true && break
        echo -n "."; sleep 1
      done
      echo ""
      if $SERVER_OK; then
        echo "✓ 쿠마 서버 정상 기동 ($INFRA_S)"
      else
        echo "✗ 쿠마 서버 기동 실패"
        cmux read-screen --surface "$INFRA_S" --lines 15 2>/dev/null || true
        exit 1
      fi
    fi

    # 프론트 시작 (같은 pane에 새 탭)
    if ! $FRONT_ALIVE; then
      STALE_PID=$(lsof -i :5173 -t 2>/dev/null)
      [ -n "$STALE_PID" ] && kill "$STALE_PID" 2>/dev/null && sleep 1
      echo "→ 스튜디오 프론트 시작 중..."
      FR=$(cmux new-surface --pane "$INFRA_P" 2>&1)
      FRONT_S=$(echo "$FR" | grep -oE 'surface:[0-9]+')
      "$SCRIPT_DIR/kuma-cmux-send.sh" "$FRONT_S" "cd \"$KUMA_STUDIO_DIR\" && npm run dev:studio" > /dev/null
      cmux tab-action --action rename --surface "$FRONT_S" --title "kuma-frontend" > /dev/null 2>&1
      "$SCRIPT_DIR/kuma-cmux-register.sh" "kuma-studio" "frontend" "$FRONT_S" 2>/dev/null || true

      echo -n "  기동 대기"
      FRONT_OK=false
      for i in $(seq 1 30); do
        curl -sf http://localhost:5173/studio/ > /dev/null 2>&1 && FRONT_OK=true && break
        echo -n "."; sleep 1
      done
      echo ""
      if $FRONT_OK; then
        echo "✓ 스튜디오 프론트 정상 기동 ($FRONT_S)"
      else
        echo "✗ 스튜디오 프론트 기동 실패"
        cmux read-screen --surface "$FRONT_S" --lines 15 2>/dev/null || true
        exit 1
      fi
    fi

    # 인프라 pane 높이 줄이기 (CTO가 세로 70% 차지)
    cmux resize-pane --pane "$INFRA_P" -U --amount 15 > /dev/null 2>&1 || true
  else
    echo "✗ 인프라 pane 생성 실패"
    exit 1
  fi
fi

# 4. 워크스페이스 + CTO 탭 이름 설정
cmux workspace-action --action rename --title "🐻 kuma studio" > /dev/null 2>&1 || true
cmux tab-action --action rename --surface surface:1 --title "🐻 쿠마" > /dev/null 2>&1 || true
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
exec claude --dangerously-skip-permissions --channels plugin:discord@claude-plugins-official -- "/kuma"
