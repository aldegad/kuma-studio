---
name: overnight-on
description: Enable Kuma overnight autonomous mode and keep plans updated while the user is away.
user-invocable: true
---

# /kuma:overnight-on — 🌙 야근모드 ON

쿠마를 야근 자율모드로 전환한다. 유저가 자거나 자리를 비운 동안 쿠마가 혼자 결정 → 실행 → 검증까지 돌리는 모드.

## 무엇을 하는가

1. **kuma-studio 야근모드 토글 ON**
   - `POST http://127.0.0.1:4312/studio/nightmode {"enabled": true}`
   - 성공 시 `/tmp/kuma-nightmode.flag` 파일 생성 (`packages/server/src/studio/nightmode-store.mjs`)
   - GUI 오피스 설정패널 토글도 동기화됨
2. **쿠마 행동 모드 변경** — 유저 응답 대기 없이 자율 진행
3. **작업 진행 상황을 `.kuma/plans/` 체크리스트로 실시간 갱신**

## 활성화 방법

- 슬래시: `/kuma:overnight-on`
- 자연어: "야근모드 온", "야근 모드 켜줘", "overnight on"

## 활성화 시 쿠마가 즉시 수행하는 것

### Step 0. Preflight — 파란 플랜 스캔 (필수)

야근모드 ON **전에** 전체 active 플랜의 frontmatter `status` 를 스캔한다.
**색상은 플랜 frontmatter `status` 로만 결정됨** (코드 근거: `packages/server/src/studio/plan-store.mjs:13-19` — `active/in_progress=파랑, hold=노랑, blocked=주황, completed=초록, failed=빨강`).

```bash
# 현재 active 상태인 플랜 확인
find "${KUMA_PLANS_DIR:-.kuma/plans}" -name '*.md' -exec grep -l 'status: active' {} +
```

파란(active) 플랜이 **야근 scope 외**에 남아있으면 처리:
1. 유저에게 리스트 제시 (플랜 파일 경로 + 제목 + 미완료 항목 요약)
2. 각 플랜의 처리 방안을 유저에게 확인:
   - **야근 scope 포함** → `status: active` 유지, 담당 워커 스폰 준비
   - **HOLD (노란색)** → frontmatter `status: hold` + `status_reason: "유저 HOLD YYYY-MM-DD — <사유>"`
   - **BLOCKED (주황색)** → frontmatter `status: blocked` + `status_reason: "유저 판단 필요 — <질문>"`
   - **완료 전환** → `status: completed` (이미 끝났는데 상태 갱신 누락)
3. 야근 scope 밖 active 플랜 **0개** 확인 후 야근모드 ON 진행

> **Why:** 야근모드 중 scope 밖 파란 플랜이 남으면 (1) 미처리 방치 또는 (2) 쿠마 자체 판단 처리로 유저 의도와 어긋날 위험. 유저 원칙 (2026-04-09 확정): "야근모드할때 파란색 안남게 하랬자나. 없게하는 방법은 내가 hold를 지시했으면 hold(노란색). 그리고 니가 내 판단이 필요하다는것 request? block? (주황색)". 파란색 = 지금 작업중인 야근 scope 만 해당.

### Step 1. 야근모드 토글 ON

1. 쭈니에게 curl 위임 (또는 쿠마가 직접):
   ```bash
   curl -sS -X POST http://127.0.0.1:4312/studio/nightmode \
     -H 'Content-Type: application/json' \
     -d '{"enabled":true}'
   ```
2. `/tmp/kuma-nightmode.flag` 존재 확인 (flag 없으면 실패로 간주)
3. 현재 Active 플랜 (`.kuma/plans/index.md`) 에서 미완료 체크리스트 전수 파악
4. 가용 워커 전원에 병렬 배분 (idle 워커 없게)
5. 디스코드에 "야근모드 ON. 오늘 할 일: [요약]. 잘 자." 한 줄 보고
6. 이후 작업 완료 / 블로커 발생 / 아침에 유저 복귀 까지 자율 진행

## 행동 규칙 (모드 ON 동안)

| 원래 규칙 | 야근모드 오버라이드 |
|---|---|
| 설계 결정은 유저에게 물어라 | 최선의 판단으로 진행. 이유를 디코와 플랜 파일에 남긴다 |
| "내가 결정해줘야 할 사항 있어?" 질문 | **금지**. 결정 필요하면 쿠마가 합리적 선택 후 기록 |
| 리스크 있는 작업은 확인받기 | 파일 다수 수정 리팩토링/마이그레이션 진행 OK |
| 유저 응답 대기 | 응답 없으면 쭉 진행 |
| 워커 에러 시 멈춤 | 에러 시 디코 보고 + 대안 시도 + 계속 진행 (침묵 금지) |
| 완료 보고 전 모든 체크리스트 통과 | 완료 못 한 체크리스트는 플랜에 이유 남기고 다음 블로커로 이월 |

## 야근모드에서도 여전히 금지되는 것 (안전 가드)

다음은 야근모드에서도 반드시 유저 확인 없이 실행 금지:
- `git push --force` 특히 main/master
- `git reset --hard` 공개 브랜치
- `rm -rf` 대량 삭제
- DB drop / truncate / migration down
- production deploy / release
- 외부 서비스 결제/과금 트리거
- 3rd party 비공개 자료 업로드

야근모드는 **자율성 확장**이지 **안전 가드 해제**가 아니다. 위 작업은 유저가 자더라도 디코에 블로커로 남기고 다음 작업으로 넘어간다.

## 블로커 발생 시

1. 블로커 내용을 플랜 파일 체크리스트에 `- [ ] (BLOCKED) <이유>` 로 기록
2. 디스코드에 한 줄 보고 (답변 기대하지 말 것)
3. 다음 블로커로 진행
4. 아침에 유저 복귀 시 블로커 전체를 요약 보고

## 아침 복귀 시 수행할 루틴

유저의 첫 메시지가 감지되면 자동으로:
1. 야근모드 동안 완료된 작업 요약 (plan 기준)
2. 블로커 리스트
3. 유저가 결정해줄 사항 리스트
4. 디스코드에 보고

## 야근모드 OFF

- 슬래시: `/kuma:overnight-off` (별도 스킬)
- 자연어: "야근모드 끄기", "야근 모드 종료", "overnight off"
- API: `POST /studio/nightmode {"enabled": false}` → flag 파일 삭제

## Related

- kuma-studio GUI 오피스 설정패널 — 야근모드 토글
- `packages/server/src/studio/nightmode-store.mjs` — flag 파일 store
- `packages/server/src/studio/studio-routes.mjs` 644-677 — `/studio/nightmode` GET/POST
- `/tmp/kuma-nightmode.flag` — 활성화 상태 flag 파일
