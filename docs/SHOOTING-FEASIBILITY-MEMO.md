# Canvas Game Interaction — 쿠마피커 역량 분석 메모

## 배경

- 쿠마피커로 **캔버스 기반 게임**(슈팅, Three.js, Phaser 등)을 플레이시키고 싶다.
- DOM 테스트는 스도쿠 등이 이미 커버. 이건 **DOM이 아닌 세계**를 다루는 것이 목적.
- 캔버스 게임에서 관찰 수단은 **screenshot뿐** (DOM tree가 없으므로).

## 기존 문제 분석

### 1. `dispatchClickSequence`는 즉발

```js
// agent-actions-interaction.js:94-100
function dispatchClickSequence(target, clientX, clientY) {
  dispatchMouseEvent(target, "pointerdown", clientX, clientY);
  dispatchMouseEvent(target, "mousedown", clientX, clientY);
  dispatchMouseEvent(target, "pointerup", clientX, clientY);  // ← 즉시
  dispatchMouseEvent(target, "mouseup", clientX, clientY);
  dispatchMouseEvent(target, "click", clientX, clientY);
}
```

pointerdown→pointerup 사이에 시간 0ms. 게임 입장에서 0프레임 터치.

### 2. `pointermove`가 아예 없었다

기존 커맨드: click, click-point, fill, key, dom, context, console, query-dom, measure, wait-*, sequence.
**연속 제스처 프리미티브 없음.**

### 3. 400ms 딜레이

DOM 앱에서는 합리적 (클릭 → React 리렌더 대기).
캔버스에서는 무의미. 이미 `postActionDelayMs: 0`으로 설정 가능하므로 구조적 문제는 아님.

## 해결: `page.mouse.drag` 기반 경로 입력

### 기본형 (from → to)

```bash
cat <<'EOF' | node ./packages/server/src/cli.mjs run --tab-id 123
await page.mouse.drag({ x: 200, y: 500 }, { x: 300, y: 400 }, { durationMs: 500 });
EOF
```

### waypoints 지원

```bash
// v1은 waypoints를 직접 지원하지 않으므로 여러 drag/move 호출로 구성한다.
```

### 동작 원리

```
pointerdown(from) → mousedown(from)
  → [pointermove + mousemove] × N steps (durationMs / 16 ≈ 60fps)
pointerup(to) → mouseup(to)
```

- `steps` 파라미터로 이벤트 밀도 조절 가능 (기본: `durationMs / 16`)
- `postActionDelayMs` 기본값 0 (캔버스 게임 최적화)
- waypoints 간 거리 비례로 보간 → 직선이 아닌 경로도 지원
- sequence 안에서 사용 가능

### 활용 범위 (게임만이 아님)

- 슬라이더, 지도 패닝, 드래그앤드롭, 스와이프, 드로잉
- 롱프레스: from === to + durationMs로 대체 가능
- 게임: 슈팅, 퍼즐, 시뮬레이션

## 반응성 향상 방법론

### A. clip screenshot — 눈을 빠르게

전체 화면 대신 관심 영역만 캡처:
```bash
cat <<'EOF' | node ./packages/server/src/cli.mjs run --tab-id 123
await page.screenshot({ path: "/tmp/region.png", clip: { x: 100, y: 300, width: 200, height: 200 } });
EOF
```
이미지가 작으면 캡처도 빠르고 LLM 추론도 빠름.

### B. waypoints — 손을 길게

LLM 추론 1회에 2~3초치 경로를 한 번에 계획:
```json
{
  "type": "pointer-drag",
  "waypoints": [
    {"x": 200, "y": 500},
    {"x": 150, "y": 450},
    {"x": 300, "y": 400},
    {"x": 250, "y": 500}
  ],
  "durationMs": 2000
}
```
추론 병목(~800ms)을 실행 시간(2초)으로 상쇄.

### C. sequence 안에서 drag + screenshot 교차 — 보면서 움직이기

```json
{
  "type": "sequence",
  "steps": [
    {"type": "pointer-drag", "fromX": 200, "fromY": 500, "toX": 150, "toY": 450, "durationMs": 500},
    {"type": "screenshot", "clipRect": {"x": 100, "y": 300, "width": 200, "height": 200}},
    {"type": "pointer-drag", "fromX": 150, "fromY": 450, "toX": 300, "toY": 400, "durationMs": 500},
    {"type": "screenshot", "clipRect": {"x": 100, "y": 300, "width": 200, "height": 200}}
  ]
}
```
라운드트립 1회에 "움직이고 → 보고 → 움직이고 → 보고". 중간 관찰 데이터가 다음 판단의 근거.

### D. 현실적 에이전트 루프

```
1. clip-screenshot (관심 영역만, ~20ms)
2. LLM: 적 위치 파악 + 2초치 회피 경로 계획 (~800ms)
3. pointer-drag waypoints 2초 실행
4. 다시 1로
```
**3초에 한 사이클, 그중 2초는 실제 움직임.** 게임 난이도를 이 주기에 맞추면 플레이 가능.

## 열린 질문

- 멀티 포인터(핀치 줌)는 스코프 밖이지만 구조는 확장 가능하게 유지
- pointer-drag 실행 중에 관찰 명령을 동시에 보내려면? (현재 WebSocket은 직렬)
- 게임 난이도 파라미터화는 게임별로 다름 — 범용 전략은 아님, 벤치마크 테스트베드 전용
