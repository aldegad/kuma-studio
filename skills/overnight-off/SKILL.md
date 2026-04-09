---
name: overnight-off
description: Disable Kuma overnight autonomous mode and summarize what happened overnight.
user-invocable: true
---

# /kuma:overnight-off — 🌅 야근모드 OFF

쿠마의 야근 자율모드를 종료하고 유저 대기 모드로 복귀한다.

## 무엇을 하는가

1. **kuma-studio 야근모드 토글 OFF**
   - `POST http://127.0.0.1:4312/studio/nightmode {"enabled": false}`
   - 성공 시 `/tmp/kuma-nightmode.flag` 파일 삭제
   - GUI 오피스 설정패널 토글도 동기화
2. **쿠마 행동 모드 원복** — 설계 결정은 다시 유저에게 물어본다
3. **아침 복귀 루틴 실행** — 야근모드 동안 진행된 내용을 요약 보고

## 활성화 방법

- 슬래시: `/kuma:overnight-off`
- 자연어: "야근모드 끄기", "야근 모드 종료", "overnight off", "야근모드 오프"

## 활성화 시 쿠마가 즉시 수행하는 것

1. 쭈니에게 curl 위임 (또는 쿠마가 직접):
   ```bash
   curl -sS -X POST http://127.0.0.1:4312/studio/nightmode \
     -H 'Content-Type: application/json' \
     -d '{"enabled":false}'
   ```
2. `/tmp/kuma-nightmode.flag` 삭제 확인 (여전히 있으면 실패로 간주하고 재시도)
3. 야근모드 동안 진행된 작업 요약:
   - Active 플랜 (`.kuma/plans/index.md`) 에서 **새로 완료된 체크리스트** 전수 스캔
   - 야근 중 발생한 블로커 리스트
   - 유저가 결정해줘야 할 사항 리스트 (야근모드 동안 쿠마가 자체 판단한 항목들)
   - Discord 로 한 번에 정리 보고
4. 행동 규칙 원상복구:
   - 설계 결정 → 유저 질문
   - 리스크 작업 → 확인 요청
   - 완료 보고 전 체크리스트 전수 확인

## 아침 요약 보고 포맷

```
🌅 야근모드 OFF. 어제/오늘 밤 작업 요약:

■ 완료
- Phase X: ...
- Phase Y: ...

■ 블로커 (유저 판단 필요)
- <블로커 1> — 이유 / 쿠마의 임시 대응
- <블로커 2> — ...

■ 쿠마가 자체 판단한 사항 (사후 승인 요청)
- <결정 1>: <선택한 방향> / <근거>
- <결정 2>: ...

■ 다음 할 일
- <남은 체크리스트>

잘 잤어? 이어갈 준비됐어.
```

## Related

- `/kuma:overnight-on` — 야근모드 진입
- `packages/server/src/studio/nightmode-store.mjs` — flag 파일 store
- `packages/server/src/studio/studio-routes.mjs` 644-677 — `/studio/nightmode` endpoint
- `/tmp/kuma-nightmode.flag` — 활성화 상태 flag
