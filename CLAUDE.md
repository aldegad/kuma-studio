# Claude 워크플로우

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

## 보고 워딩 규칙
- 이미 실행한 액션은 반드시 과거형으로 보고한다: "넣었어", "시켰어", "저장했어" (O) / "넣을게", "시킬게", "저장할게" (X)
- 유저가 내가 뭘 했는지 인지하게 하는 게 목적. 이미 한 일을 미래형으로 말하면 안 한 것처럼 들린다.

## 절대 금지 규칙
- **Playwright 사용 금지.** 스크린샷은 반드시 쿠마피커(kuma-picker)로 찍는다. Playwright headless browser 절대 금지.
- **fallback/backfill 패턴 절대 금지.** 실패하면 실패로 보고. 자동 재전달/auto-redispatch/다른 소스에서 보충 절대 금지. SSOT 하나만 사용.
- **서버 포트는 4312.** 3000/3001 아님. 확인 없이 포트 추측 금지.
- **관리형 infra surface 우선.** `kuma-server` 가 있으면 거기서만 서버를 재시작한다. 현재 터미널에서 중복 기동 금지.
- **infra registry continuity 유지.** daemon exit 만으로 `kuma-server` registry key 를 잃어버리면 안 된다. registry miss 시에는 현재 workspace 의 living infra surface 를 재발견·재등록한 뒤 같은 slot 을 재사용한다.
- **브랜치/워크트리 임의 생성 금지.** 알렉스가 명시적으로 지시한 경우에만 새 git branch 또는 git worktree 를 만든다.
- **충돌 회피 목적의 branch/worktree 도 사전 승인 필수.** 작업 충돌이 예상되면 이유를 먼저 보고하고 허가를 받은 뒤에만 분리한다.

## 디스패치 엔트리포인트

엔트리포인트 계층 (의도된 분리, drift 아님):
- Kuma main thread (Claude) → `kuma-task <worker> ...` + `kuma-dispatch` broker lifecycle 직접.
- Background polling/wait helpers 는 safety net 이며 completion authority 가 되면 안 된다.
- Worker / QA / Codex sub-worker → `kuma-task` + `kuma-dispatch ask|reply|complete|fail|qa-pass|qa-reject` 직접. CLI 가 canonical 이고 slash-skill 등가물은 없다.

## 컨벤션

- 서버 부팅/재시작은 휴먼/오퍼레이터 shared-infra surface 재사용 시 `npm run kuma-server:reload`, raw in-surface/로컬 엔트리포인트는 `npm run server:reload` 로 표준화한다.
- managed `kuma-server` surface 가 이미 있으면 다른 곳에서 서버를 새로 띄우지 말고 `npm run kuma-server:reload` 로 그 데몬을 재시작한다.
- 서버 코드는 `.mjs` (ESM) 를 쓴다.
- 프론트엔드 코드는 TypeScript (`.ts`, `.tsx`).
- Browser extension 은 vanilla JS, 빌드 단계 없음.
- WebSocket 프로토콜: 브라우저 브리지는 `kuma-picker:*`, dashboard/office 이벤트는 `kuma-studio:*`.

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
- `No Fallback` — silent fallback, guessed path, shadow path, legacy backfill 로 primary truth 실패를 가리지 않는다. live truth 가 비어 있거나 어긋나면 canonical source 를 바로 고친다.

허용 예외:
- provider failover 처럼 설계 단계에서 명시적이고 관측 가능한 failover 는 둘 수 있다. 예: Gemini 실패 시 GPT API 로 전환.
- 이런 failover 도 canonical truth 를 둘로 쪼개거나 divergence 를 숨기면 안 된다. secondary path 는 대체 실행 경로일 뿐, 다른 truth source 가 되면 안 된다.
