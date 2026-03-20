# Playwright 대응 벤치마크

이 문서는 Kuma Picker와 Playwright를 직접 비교할 때 쓰는 기준 문서입니다.

역할은 세 가지입니다.

- 벤치마크 기준서
- 점수표(scorecard)
- 결과 보고서 템플릿

## 이 문서를 뭐라고 부르면 되나

아래 표현이 모두 괜찮습니다.

- 벤치마크 문서
- 대응 벤치마크
- 비교 점수표
- 벤치마크 리포트

이 저장소에서는 `Playwright 대응 벤치마크`라고 부르는 쪽으로 통일합니다.

## 목표

Kuma Picker의 브라우저 조작 기본기가 Playwright에 얼마나 가까워졌는지 수치로 비교합니다.

여기서 중요한 건 단순 실행 속도만이 아닙니다.
실제로는 아래 항목이 더 중요합니다.

- 조작 성공률
- 오입력 비율
- 새로고침/재연결 후 복구 속도
- 검증 비용
- 사람 개입 필요 횟수

즉, “실제로 믿고 쓸 수 있느냐”를 보는 문서입니다.

## 핵심 측정 지표

### 1. 작업 성공률

정의:
- 완료된 시나리오 실행 수 / 전체 실행 수

표기:
- 퍼센트

예시:
- `18/20 = 90%`

### 2. 오입력률

정의:
- 잘못된 대상, 잘못된 값, 잘못된 탭, 잘못된 UI 상태를 만든 실행 수 / 전체 실행 수

예시:
- 엉뚱한 입력창에 타이핑함
- 다른 카드나 다른 탭을 클릭함
- 잘못된 Sudoku 셀에 값이 들어감
- 다른 composer에 붙여넣음
- 원한 surface가 아니라 다른 화면을 열어버림

표기:
- 퍼센트

### 3. 중앙값 지연 시간

정의:
- 명령을 보낸 시점부터 “검증까지 완료된 시점”까지의 시간 중앙값

표기:
- 밀리초(ms)

예시:
- 클릭 -> URL 변경 확인
- fill -> `selector-state`로 값 확인
- screenshot -> 파일 메타데이터 반환 확인

### 4. P95 지연 시간

정의:
- 같은 액션군에서 95퍼센타일 완료 시간

왜 필요한가:
- 평균값은 괜찮아 보여도 가끔 심하게 느리거나 흔들리는 tail latency를 잡아낼 수 있습니다.

### 5. 복구 지연 시간

정의:
- 페이지 새로고침, 라우트 전환, 브릿지 재연결 이후 다음 명령을 다시 정상 수행할 때까지 걸리는 시간

표기:
- 밀리초(ms)

### 6. 검증 오버헤드

정의:
- “정말 입력이 반영됐다”를 증명하기 위해 추가로 들어가는 시간과 명령 수

예시:
- 전체 `browser-dom` 덤프가 필요한가
- `selector-state` 하나로 충분한가
- screenshot + 텍스트 확인까지 필요한가

표기:
- 명령 수 + 밀리초(ms)

### 7. 수동 개입 횟수

정의:
- 한 벤치마크 배치 동안 사람이 직접 extension reload, page refresh, tab retarget을 해줘야 했던 횟수

표기:
- 정수

### 8. 포커스 탈취 횟수

정의:
- 사용자가 보고 있던 활성 탭이나 창이 예기치 않게 뺏긴 횟수

표기:
- 정수

## 표준 벤치마크 대상

우선은 저장소에 들어있는 테스트 앱으로 비교합니다.

| Surface | Route | 보는 이유 |
| --- | --- | --- |
| Lab home | `/` | 의미 기반 클릭, 화면 전환, 스크린샷 |
| Agent chat | `/agent-chat` | 텍스트 입력, 복사/붙여넣기/잘라내기, reset, 읽기 검증 |
| Contenteditable lab | `/contenteditable-lab` | 멀티라인 `contenteditable` 쓰기, 줄바꿈 보존, readback |
| Sudoku | `/sudoku` | 촘촘한 셀 타겟팅과 키보드 정밀도 |
| Cafe control room | `/cafe-control-room` | 탭, 콤보박스, 다이얼로그, 토스트, 다운로드 흐름 |
| Shooting range | `/shooting` | hold 입력, drag 입력, 포커스, 새로고침 내성, 실시간 메트릭 |

## 시나리오 세트

### Agent chat

- `1P` 입력창 채우기
- 메시지 전송
- transcript readback 확인
- `Meta/Ctrl + A`
- `Meta/Ctrl + C`
- `Meta/Ctrl + V`
- `Meta/Ctrl + X`
- reset 후 초기 상태 확인

### Sudoku

- 편집 가능한 셀 클릭
- 숫자 입력
- 값 검증
- 페이지 새로고침
- 다른 셀에서 반복

### Contenteditable lab

- 멀티라인 `contenteditable` 채우기
- 줄바꿈 보존 확인
- 같은 요소 readback 검증
- 이어쓰기(`insertText`) 시나리오 확장 가능 여부 확인

### Cafe control room

- 탭 전환
- combobox 열기
- 보이는 텍스트로 옵션 선택
- 다이얼로그 저장
- 토스트 대기
- 다운로드 권한 상태 확인

### Shooting range

- 런처에서 surface 열기
- 게임 시작
- hold 입력으로 발사
- drag 입력으로 이동
- `shots fired`, `total inputs` 검증

## 측정 규칙

### 실행 횟수

시나리오별 권장 수:

- 스모크 테스트: 3회
- 의미 있는 비교: 10회
- 안정성 배치: 20회

### 성공 판정 규칙

입력만 들어갔다고 성공으로 치지 않습니다.
반드시 후속 검증까지 성공해야 성공입니다.

예시:

- chat composer 값이 `selector-state`로 확인됨
- Sudoku 셀 값이 DOM readback으로 확인됨
- shooting 메트릭이 selector로 확인됨

### 시간 측정 시작과 끝

시작:
- 제어 명령을 dispatch한 순간

끝:
- 기대한 상태가 검증된 순간

### 실패 분류

실패한 실행에는 아래 라벨 중 하나를 대표 원인으로 붙입니다.

- `bridge_unavailable`
- `wrong_target`
- `wrong_value`
- `timeout`
- `focus_stolen`
- `requires_manual_reload`
- `unknown`

## 점수표 템플릿

시나리오와 도구 조합마다 한 줄씩 기록합니다.

| 날짜 | 도구 | Surface | 시나리오 | 실행 수 | 성공률 | 오입력률 | 중앙값 ms | P95 ms | 복구 ms | 수동 개입 | 포커스 탈취 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Kuma | `/agent-chat` | fill + selector-state 검증 | 10 | 0% | 0% | 0 | 0 | 0 | 0 | 0 | pending |
| YYYY-MM-DD | Playwright | `/agent-chat` | fill + DOM 검증 | 10 | 0% | 0% | 0 | 0 | 0 | 0 | 0 | pending |

## 2026-03-20 측정 결과

대상:

- Surface: `/agent-chat`
- 시나리오: `1P` 입력창 fill 후 값 검증
- Kuma 검증 방식: `browser-sequence` 안의 `selector-state` assert
- Playwright 검증 방식: `fill` 후 `eval "el => el.value"`
- 실행 수: 각 10회
- 복구 지연 시간: 이번 배치에서는 측정하지 않음
- 수동 개입: 0회
- 포커스 탈취: 0회

| 날짜 | 도구 | Surface | 시나리오 | 실행 수 | 성공률 | 오입력률 | 중앙값 ms | P95 ms | 복구 ms | 수동 개입 | 포커스 탈취 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-03-20 | Kuma | `/agent-chat` | fill + selector-state 검증 | 10 | 100% | 0% | 389.4 | 405.9 | 미측정 | 0 | 0 | 검증 포함 단일 CLI 호출 |
| 2026-03-20 | Playwright | `/agent-chat` | fill + eval 값 검증 | 10 | 100% | 0% | 3033.1 | 3100.0 | 미측정 | 0 | 0 | fill와 eval 두 번의 CLI 호출 |
| 2026-03-20 | Kuma | `/agent-chat` | 1P send 후 reset + 빈 composer/`No dispatches` 검증 | 10 | 100% | 0% | 2655.2 | 2676.6 | 미측정 | 0 | 0 | `fill -> send click -> reset click` 뒤 빈 textarea와 빈 transcript 상태를 같은 sequence에서 검증 |
| 2026-03-20 | Playwright | `/agent-chat` | 1P send 후 reset + 빈 composer/`No dispatches` 검증 | 10 | 100% | 0% | 7189.0 | 7368.5 | 미측정 | 0 | 0 | `fill`, `click`, `click`, `eval`, `eval` 다섯 번의 CLI 호출로는 안정적이지만 지연 시간이 큼 |
| 2026-03-20 | Kuma | `/contenteditable-lab` | 멀티라인 fill + selector-state 검증 | 10 | 100% | 0% | 378.8 | 432.7 | 미측정 | 0 | 0 | `contenteditable` 대상에 줄바꿈 포함 값을 직접 쓰고 같은 요소의 value를 즉시 검증 |
| 2026-03-20 | Playwright | `/contenteditable-lab` | 멀티라인 fill + eval readback | 10 | 60% | 40% | 2868.1 | 3003.0 | 미측정 | 0 | 0 | 같은 `textbox` ref `e15`를 유지했지만 일부 실행에서 `innerText` readback이 직전 값으로 남아 배치 성공률이 흔들림 |
| 2026-03-20 | Kuma | `/contenteditable-lab` | fill + Enter + insertText + selector-state 검증 | 10 | 100% | 0% | 607.4 | 622.0 | 미측정 | 0 | 0 | `fill -> key Enter -> insertText`를 한 시퀀스로 묶고 최종 줄바꿈 상태까지 단일 검증으로 닫음 |
| 2026-03-20 | Playwright | `/contenteditable-lab` | fill + Enter + type + eval readback | 10 | 100% | 0% | 4670.4 | 4705.0 | 미측정 | 0 | 0 | `fill`, `press Enter`, `type`, `eval` 네 번의 CLI 호출로는 안정적이지만 비용이 큼 |
| 2026-03-20 | Kuma | `/sudoku` | `cell-1-3` 클릭 + 숫자 입력 + selector-state 검증 | 10 | 100% | 0% | 779.8 | 1354.0 | 미측정 | 0 | 0 | `browser-sequence`로 클릭과 키 입력을 묶고 같은 셀의 값까지 검증 |
| 2026-03-20 | Playwright | `/sudoku` | row 1 col 3 snapshot ref 클릭 + 숫자 입력 + snapshot 검증 | 10 | 10% | 90% | 417.3 | 2794.3 | 미측정 | 0 | 0 | snapshot 기반 ref가 셀 재렌더 중 자주 사라져 `row 1 column 3` ref 재탐색 실패가 반복됨 |
| 2026-03-20 | Kuma | `/shooting` | reset/start + 500ms fire hold + shots fired readback | 5 | 100% | 0% | 4050.8 | 4067.8 | 미측정 | 0 | 0 | `browser-key --hold-ms 500`가 window-level key listener까지 도달하도록 보강 후 측정 |
| 2026-03-20 | Playwright | `/shooting` | reset/start + 500ms fire hold + shots fired snapshot readback | 5 | 0% | 100% | 4796.8 | 4838.3 | 미측정 | 0 | 0 | 같은 시나리오에서 `Shots Fired`가 끝까지 증가하지 않았고 snapshot readback도 0에 머묾 |
| 2026-03-20 | Kuma | `/cafe-control-room` | Delivery 탭 클릭 + selected-state 검증 | 10 | 100% | 0% | 2020.3 | 2038.5 | 미측정 | 0 | 0 | `browser-click` 후 `tab-state` readback으로 선택 상태를 바로 검증 |
| 2026-03-20 | Playwright | `/cafe-control-room` | Delivery 탭 클릭 + snapshot selected 검증 | 10 | 0% | 100% | 3133.6 | 3417.1 | 미측정 | 0 | 0 | snapshot 기준 `Delivery` 탭 selected 상태가 끝까지 안정적으로 반영되지 않음 |
| 2026-03-20 | Kuma | `/cafe-control-room` | Crew Station 열기 + Bakery Shelf 선택 + selected-option 검증 | 10 | 100% | 0% | 2557.4 | 2735.3 | 미측정 | 0 | 0 | `browser-click` 두 번 뒤 `selected-option` readback으로 실제 선택값을 확인 |
| 2026-03-20 | Playwright | `/cafe-control-room` | Crew Station 열기 + Bakery Shelf 선택 + snapshot readback | 10 | 60% | 40% | 4961.1 | 5078.5 | 미측정 | 0 | 0 | 콤보박스 ref는 찾았지만 option snapshot과 선택 후 readback이 일부 실행에서 흔들림 |
| 2026-03-20 | Kuma | `/cafe-control-room` | New Signature Recipe 저장 + toast/dialog-close 검증 | 10 | 100% | 0% | 2316.2 | 2333.5 | 미측정 | 0 | 0 | dialog 열기부터 저장 후 toast와 dialog close까지 한 sequence 안에서 검증 |
| 2026-03-20 | Playwright | `/cafe-control-room` | New Signature Recipe 저장 + toast/dialog-close 검증 | 10 | 0% | 100% | 9080.6 | 9582.7 | 미측정 | 0 | 0 | 같은 flow에서 저장 후 toast 텍스트 readback이 false로 남고 dialog count도 1이라 postcondition을 10회 모두 만족하지 못함 |

## 해석 메모

- `/sudoku` 배치에서는 속도보다 안정성 차이가 더 크게 드러났습니다.
- `/contenteditable-lab` 배치에서도 Kuma는 줄바꿈 보존과 readback을 한 호출 안에서 묶어 10/10을 유지했습니다.
- 같은 surface에서 Playwright CLI는 `fill` 자체는 대체로 성공했지만, 뒤이은 `eval` readback이 간헐적으로 직전 값에 머물러 10회 중 4회가 오입력으로 기록됐습니다.
- 반대로 같은 surface의 `Enter + 이어쓰기` 시나리오에서는 둘 다 10/10을 기록했지만, Kuma는 단일 sequence 호출로 끝났고 Playwright는 4개의 개별 명령을 쌓아야 해서 지연 시간이 크게 벌어졌습니다.
- `/agent-chat reset` 시나리오도 둘 다 10/10이었지만, Kuma는 상태 복구 검증까지 한 시퀀스로 닫았고 Playwright는 5개의 개별 명령을 쌓아야 해서 중앙값이 약 4.5초 더 길었습니다.
- `/cafe-control-room`의 seasonal dialog 저장은 Kuma 쪽 semantic click + label fill + toast/dialog-close wait 조합이 강했고, Playwright CLI는 같은 후속 상태를 안정적으로 닫지 못했습니다.
- Kuma는 같은 logical cell을 selector로 고정한 뒤 `click -> key -> selector-state`를 한 호출 안에서 검증해서 10/10을 유지했습니다.
- Playwright는 Sudoku 셀이 입력 후 바로 재렌더되면서 snapshot ref가 자주 바뀌었고, 스킬 권장 루프인 `snapshot -> click -> press -> snapshot` 기준에선 row 1 column 3 ref를 9/10에서 다시 찾지 못했습니다.
- 즉 현재 기준으로는 “세밀한 셀 타겟팅과 입력 검증” 영역에서 Kuma 기본기가 Playwright CLI snapshot 흐름보다 더 실전적입니다.

## 진행 중 메모

- `/shooting`은 전용 benchmark 보조 표면으로 `Start Run` / `Reset Stage` 버튼을 추가한 뒤 수치화했습니다.
- 이 surface에서 중요한 건 click 자체보다 `500ms` 이상 유지되는 fire 입력이 실제 게임 루프에 전달되느냐입니다.
- Kuma는 `browser-key --hold-ms`를 non-text target에서도 window listener까지 mirror하도록 보강한 뒤 5/5를 기록했습니다.
- Playwright CLI는 같은 `keydown z -> 500ms -> keyup z` 시나리오에서 snapshot readback 기준 `Shots Fired`가 증가하지 않았습니다.
- `/cafe-control-room`에서는 캔버스나 실시간 입력 문제가 아니라, 탭 전환 후 selected-state를 다시 읽는 안정성에서 차이가 났습니다.
- 같은 surface의 `Crew Station` 커스텀 combobox에서는 Playwright도 일부 성공했지만, `option` ref 확보와 선택 후 snapshot readback이 10회 중 4회 흔들렸습니다.
- 반면 Kuma는 semantic click과 `selected-option` readback 조합으로 10/10을 유지했습니다.
- Kuma는 `tab-state`라는 앱-의미 기반 readback이 있어서 클릭 후 postcondition을 짧게 검증할 수 있었고, Playwright CLI snapshot 루프는 같은 상태를 10회 연속 안정적으로 따라가지 못했습니다.

### 해석

- 이번 배치에서는 Kuma가 같은 시나리오에서 Playwright CLI보다 훨씬 낮은 지연 시간을 보였습니다.
- 가장 큰 이유는 검증까지 포함한 호출 수 차이입니다.
  Kuma는 `browser-sequence` 한 번으로 끝났고, Playwright CLI는 `fill`과 `eval` 두 번을 호출했습니다.
- 이번 결과는 `agent-chat fill + verify`라는 좁은 시나리오 기준입니다.
  Playwright 전체가 느리다는 뜻은 아니고, 현재 이 저장소에서 쓰는 CLI 래퍼 방식 기준 수치입니다.

## 결과 요약 템플릿

배치 실행 후에는 아래 형식으로 요약합니다.

```md
## 요약

- Surface:
- 시나리오:
- 도구:
- 실행 수:
- 성공률:
- 오입력률:
- 중앙값 지연 시간:
- P95 지연 시간:
- 복구 지연 시간:
- 수동 개입 횟수:
- 포커스 탈취 횟수:
- 비고:
```

## 현재 저장소 상태

지금 저장소는 이미 숫자형 비교를 시작할 수 있을 만큼 계측 포인트가 정리된 상태입니다.

- `selector-state`로 특정 타깃의 focus/value/selection range를 바로 읽을 수 있음
- `browser-sequence` 안에서 `selector-state`를 assert로 바로 검증할 수 있음
- shooting 메트릭에 `shooting-metric-shots-fired` 같은 deterministic selector가 있음
- screenshot은 필요할 때 원래 활성 탭으로 복귀할 수 있음

즉 이제부터는 “대충 잘 된다” 수준이 아니라, 실제 수치를 채우는 벤치마크 단계로 넘어갈 수 있습니다.

## 다음 단계

가장 먼저 권장하는 비교는 아래입니다.

1. Kuma vs Playwright
2. 대상: `/agent-chat`
3. 시나리오: `1P` 입력창 fill 후 값 검증
4. 각 10회 실행
5. 성공률, 오입력률, 중앙값 ms, P95 ms 기록

그다음 Sudoku와 Shooting으로 넓히면 됩니다.
