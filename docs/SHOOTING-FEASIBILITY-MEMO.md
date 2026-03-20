# Shooting Game Feasibility — 쿠마피커 역량 분석 메모

## 현재 상태: 왜 안 되는가

### 1. `dispatchClickSequence`는 즉발이다

```js
// agent-actions-interaction.js:94-100
function dispatchClickSequence(target, clientX, clientY) {
  dispatchMouseEvent(target, "pointerdown", clientX, clientY);
  dispatchMouseEvent(target, "mousedown", clientX, clientY);
  dispatchMouseEvent(target, "pointerup", clientX, clientY);  // ← 즉시 올라감
  dispatchMouseEvent(target, "mouseup", clientX, clientY);
  dispatchMouseEvent(target, "click", clientX, clientY);
}
```

pointerdown과 pointerup 사이에 시간이 없다. 게임 입장에서는 0ms 터치.
`input.pointerDown`이 true인 프레임이 0~1개밖에 안 됨.

### 2. `pointermove`가 아예 없다

현재 커맨드 타입 전체:
- click, click-point, fill, key (인터랙션)
- dom, context, console, query-dom, measure (관찰)
- wait-for-text, wait-for-selector, wait-for-dialog-close (대기)
- sequence (조합)

**pointermove, pointerdown(단독), pointerup(단독)이 없다.**

### 3. 400ms 딜레이의 존재 이유

```js
// agent-actions-interaction.js:230
await waitForPostActionDelay(command, 400);
```

이건 "클릭 후 UI 반응을 기다리는" 딜레이다:
- 탭 전환 → 패널 교체에 수백ms
- 다이얼로그 오픈 애니메이션
- React 리렌더 사이클

**DOM 앱에서는 합리적이다.** 클릭 → DOM이 바뀜 → 바뀐 DOM을 읽어야 → 기다려야.

하지만 **캔버스 게임에서는 무의미하다.** 캔버스는 클릭 후 DOM이 안 바뀜.
게임 상태는 매 프레임 requestAnimationFrame으로 갱신됨.

**결론: 400ms는 configurable하다 (`postActionDelayMs: 0` 가능). 문제는 딜레이가 아니라 이벤트 모델 자체.**


## 필요한 것: `pointer-drag` 커맨드

### 왜 `pointer-hold`만으로는 부족한가

홀드만 추가하면:
```
pointerdown(200, 400) → 1초 기다림 → pointerup(200, 400)
```
배는 (200, 340) 근처에 가만히 있을 뿐. 탄막을 피할 수 없다.

진짜 필요한 건 **경로를 따라 움직이는 포인터 스트림**:
```
pointerdown(200, 500)
  → pointermove(180, 480) → pointermove(160, 460) → ... → pointermove(300, 400)
pointerup(300, 400)
```

### 제안: `pointer-drag` 커맨드 스펙

```js
{
  type: "pointer-drag",
  from: { x: 200, y: 500 },
  to: { x: 300, y: 400 },
  durationMs: 500,          // 드래그에 걸리는 시간
  steps: 30,                // pointermove 이벤트 개수 (default: durationMs / 16)
  postActionDelayMs: 0,     // 게임용이면 0
}
```

구현 핵심 (content script):
```js
async function executePointerDragCommand(command) {
  const fromEl = document.elementFromPoint(from.x, from.y);
  dispatchMouseEvent(fromEl, "pointerdown", from.x, from.y);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    dispatchMouseEvent(fromEl, "pointermove", x, y);
    await waitForDelay(durationMs / steps);  // ~16ms per step = 60fps
  }

  dispatchMouseEvent(fromEl, "pointerup", to.x, to.y);
}
```

### 이게 슈팅게임만을 위한 게 아니다

`pointer-drag`가 있으면 테스트 가능해지는 것들:
- **슬라이더** (range input의 thumb 드래그)
- **지도 패닝** (Google Maps, Mapbox)
- **드래그앤드롭** (칸반보드, 파일 업로드)
- **스와이프** (캐러셀, 모바일 네비게이션)
- **드로잉** (캔버스 그림판, 서명)
- **롱프레스** (컨텍스트 메뉴) — durationMs만 주고 from === to이면 롱프레스
- **핀치/줌** (멀티터치는 별도지만 단일 포인터 줌은 가능)
- **게임** (슈팅, 퍼즐, 시뮬레이션)

현재 쿠마피커는 "클릭과 타이핑의 세계"에만 있다.
pointer-drag 하나면 "연속 제스처의 세계"로 넘어간다.


## 더 근본적 질문: 이걸로 슈팅게임을 "할 수 있나"?

### 시나리오: 에이전트가 1초 동안 게임을 하려면

```
1. screenshot (30ms) → 화면 분석
2. LLM 추론 "적이 오른쪽에서 오니까 왼쪽으로 피하자" (500ms~)
3. pointer-drag 명령 전송 → 실행 (500ms 드래그)
4. 다시 screenshot...
```

**1 사이클 = ~1초.** 1초에 1번 방향 전환.
60fps 게임에서 1초면 60프레임. 탄막이 충분히 지나감.

### 이걸 해결하려면?

**방법 A: 더 빠른 관찰-행동 루프**
- screenshot 대신 DOM 메트릭 읽기 → `query-dom`으로 10ms
- 근데 에이전트 LLM 추론이 병목. 모델 응답이 500ms~수초.

**방법 B: "예측적 드래그"**
- 한 번에 긴 경로를 계획: `pointer-drag`에 웨이포인트를 줘서 2~3초치 경로를 한번에 실행
- 에이전트는 "2초 뒤 내 배가 어디 있어야 안전한가"를 계산
- `pointer-drag`에 waypoints 배열 지원:
  ```json
  {
    "type": "pointer-drag",
    "waypoints": [
      { "x": 200, "y": 500, "dwellMs": 0 },
      { "x": 150, "y": 450, "dwellMs": 300 },
      { "x": 300, "y": 400, "dwellMs": 500 },
      { "x": 250, "y": 500, "dwellMs": 0 }
    ]
  }
  ```

**방법 C: 게임 난이도를 시간에 맞추지 말고, 에이전트 루프에 맞춤**
- 이건 테스트베드 난이도를 낮추는 게 아님
- 게임의 "탄속"이나 "웨이브 간격"을 파라미터화해서, 에이전트의 관찰 주기에 맞는 난이도를 동적으로 선택
- 예: 에이전트 응답이 1초면 → 탄속을 1초에 화면 1/3 이동으로 맞춤
- 이러면 "이 에이전트는 어느 난이도까지 플레이 가능한가"가 **벤치마크 점수**가 됨


## 400ms 딜레이 재고

현재: 모든 커맨드의 기본 딜레이
- click: 400ms
- fill: 100ms
- key: 100ms

**이걸 0으로 바꾸면 안 되나?**

안 되는 이유:
- 에이전트가 `click` → `dom` 순서로 호출할 때
- 클릭이 React setState 트리거 → 다음 프레임에 리렌더
- `dom`이 즉시 실행되면 아직 이전 상태를 읽음
- 400ms는 "안전한 리렌더 대기"

**하지만** 이건 커맨드 레벨에서 강제할 게 아니라 에이전트가 판단할 문제 아닌가?
- DOM 앱 테스트: 딜레이 필요 → `postActionDelayMs: 400`
- 캔버스 게임: 딜레이 불필요 → `postActionDelayMs: 0`
- 이미 configurable하니까 OK. 다만 **기본값이 400인 게 맞는지**는 재고 가능.
- sequence 안에서는 각 step별로 딜레이를 다르게 줄 수 있으면 좋을 것.


## 결론: 해야 할 것

### 확실한 것
1. **`pointer-drag` 커맨드 추가** — from/to/duration/steps 기본형
   - content script: `executePointerDragCommand`
   - CLI: `browser-pointer-drag --from-x --from-y --to-x --to-y --duration-ms`
   - sequence 지원: `SUPPORTED_SEQUENCE_STEP_TYPES`에 추가

### 고려할 것
2. **waypoints 지원** — 단순 직선이 아닌 경로 드래그
3. **`postActionDelayMs` 기본값 정책** — 0이 맞는 컨텍스트가 있다는 것을 문서화
4. **게임 난이도 파라미터화** — 에이전트 루프 속도에 맞는 벤치마크 체계
5. **DOM 메트릭 노출** — screenshot 없이 게임 상태를 관찰하는 경로 (이건 테스트베드 쪽)

### 열린 질문
- 멀티 포인터(핀치 줌)는 당장은 스코프 밖이지만, 구조는 확장 가능하게?
- `pointer-drag` 실행 중에 관찰 명령을 동시에 보낼 수 있나? (현재 WebSocket은 직렬)
- sequence 안에서 pointer-drag + 중간중간 measure를 섞을 수 있으면 "드래그하면서 관찰"이 가능
