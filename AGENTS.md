# Codex 워크플로우

- `npm run kuma-server:reload` 는 managed `kuma-server` surface 가 있을 때 표준 휴먼/오퍼레이터 reload 경로다. 로컬 데몬을 새로 띄우지 말고 해당 surface 를 재사용해야 한다.
- `npm run server:reload` 는 포트 4312 raw in-surface/로컬 데몬 reload 엔트리포인트다.
- `npm run server:start` 는 raw non-reloading 엔트리포인트로 스크립트용이다. 휴먼/오퍼레이터 워크플로우는 `server:reload` 를 쓴다.
- `npm run kuma-studio:get-selection` 은 최신 브라우저 selection 을 읽는다.
- `npm run kuma-studio:set-job-status -- --status in_progress --message "..."` 는 job 카드를 갱신한다.
- `npm run kuma-studio:dashboard` 는 스튜디오 dashboard 를 브라우저로 연다.
- `npm run build:studio` 는 studio-web 프로덕션 번들을 빌드한다.
- `npm test` 는 vitest 로 전체 테스트를 돌린다.
- Kuma 부트스트랩이 돌고 있을 때 `kuma-server` 는 이 repo 의 canonical managed infra surface 다. 별도 터미널에서 로컬 데몬을 중복 기동하지 말고 재사용한다.
- `kuma-server` 는 managed infra slot 으로 취급한다 — 데몬 프로세스가 죽어도 surface 가 살아있으면 같은 slot 에서 재시작해 registry key 를 보존한다. disposable 로 다루지 않는다.
- infra discovery 는 `~/.kuma/cmux/kuma-cmux-project-status.sh kuma-studio` 를 우선 쓰고, `kuma-server` 를 직접 확인해야 할 때는 `cmux tree` 를 쓴다 (`kuma-status` 는 infra pseudo-member 를 숨길 수 있음).

## 프로젝트 구조

- `packages/browser-extension/` — Chrome extension (Manifest V3, vanilla JS)
- `packages/server/` — 데몬 서버 (Node.js, WebSocket, 포트 4312)
- `packages/server/src/studio/` — 스튜디오 전용 모듈 (stats, events, agent state, image gen)
- `packages/studio-web/` — Dashboard & Virtual Office (React 19, Vite, Tailwind v4, Zustand)

## 디스패치 엔트리포인트

이 repo 는 Kuma-main-thread dispatch 의 authority 가 아니다. 엔트리포인트 계층:
- Kuma main thread (Claude) → `/kuma:dispatch` slash skill (orchestration wrapper 전용).
- Worker / QA / Codex sub-worker → `kuma-task` + `kuma-dispatch ask|reply|complete|fail|qa-pass|qa-reject` 직접 호출.

CLI 가 canonical worker-facing interface 이며, Phase 4 direct main dispatch 도 main-thread canonical 경로로 `kuma-task` / `kuma-dispatch` 를 쓴다. Codex 쪽에는 slash-skill 등가물이 없고, 이 분리는 의도된 것이다.

## 컨벤션

- 서버 부팅/재시작은 휴먼/오퍼레이터 shared-infra surface 재사용 시 `npm run kuma-server:reload`, raw in-surface/로컬 엔트리포인트는 `npm run server:reload` 로 표준화한다.
- managed `kuma-server` surface 가 이미 있으면 다른 곳에서 서버를 새로 띄우지 말고 `npm run kuma-server:reload` 로 그 데몬을 재시작한다.
- managed reload/restart 는 registry miss 가 나더라도 포기 전에 현재 workspace 의 살아있는 `kuma-server` 타이틀 surface 를 재발견·재등록해야 한다.
- 유저가 명시적으로 지시하지 않으면 git 브랜치를 만들거나 바꾸지 않는다.
- 유저가 명시적으로 지시하지 않으면 git worktree 를 만들지 않는다.
- 충돌 회피 목적으로 branch/worktree 분리가 필요해 보이면 먼저 멈추고 승인을 요청한다.
- 서버 코드는 `.mjs` (ESM) 를 쓴다.
- 프론트엔드 코드는 TypeScript (`.ts`, `.tsx`).
- Browser extension 은 vanilla JS, 빌드 단계 없음.
- WebSocket 프로토콜: 브라우저 브리지는 `kuma-picker:*`, dashboard/office 이벤트는 `kuma-studio:*`.
- 스크린샷/브라우저 검사/QA 는 `kuma-picker` 를 먼저 쓴다. Playwright 는 Kuma Picker 자체를 개선하거나 Kuma Picker 로는 못하는 parity/debug 작업이 명시적으로 필요한 경우에만 쓴다.

## 공유 SSoT 원칙 (쿠마 ↔ Codex)

- 쿠마(Claude main) 와 Codex 가 둘 다 지켜야 하는 규칙/스킬 경계/워크플로우는 repo SSoT(AGENTS.md / CLAUDE.md, 또는 해당 스킬·문서 파일)에 고정한다.
- 한쪽 에이전트 전용 휴리스틱/선호만 해당 에이전트 메모리(쿠마는 `~/.claude/.../memory/`, Codex 는 자체 채널)에 둔다. SSoT 내용을 에이전트 전용 메모리에 중복 박지 않는다 — 비대칭 기록은 오해의 원인이다.
- AGENTS.md 와 CLAUDE.md 는 병렬 SSoT (Codex 는 AGENTS.md, Claude Code 는 CLAUDE.md 를 읽는다). 공유 규칙을 바꿀 때는 **같은 커밋에서 두 파일을 함께** 갱신한다.
- 규칙을 바꿀 때는 SSoT 를 먼저 갱신하고, 그와 중복되는 에이전트 전용 메모리를 정리한다.

## 알렉스 핵심 불변 6종

- `SSoT (Single Source of Truth)` — 상태·데이터·지식·설정·식별자는 한 곳에서만 canonical 하게 소유한다. 같은 truth 를 두 군데 두지 않는다. cache/index miss 가 나면 live truth 기준으로 canonical state 를 복구하는 self-heal 을 선호한다.
- `SRP (Single Responsibility Principle)` — 모듈/파일/함수는 책임 하나만 가진다.
- `Consistency / 정합성` — 데이터·상태·표현이 시스템 전반에서 서로 어긋나지 않아야 한다.
- `Atomicity / 원자성` — 작업은 전부 성공하거나 전부 롤백해야 하며 중간 상태를 노출하지 않는다.
- `Idempotency / 멱등성` — 같은 요청을 여러 번 받아도 결과가 같아야 한다.
- `No Silent Fallback` — fallback / legacy / shadow path 금지. primary 실패를 조용히 가리거나 truth 를 둘로 만드는 우회는 금지한다. 단, 가용성을 위한 명시적 failover 는 허용한다. failover 는 관측 가능해야 하고 canonical truth 를 바꾸면 안 된다.
