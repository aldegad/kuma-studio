# Claude Workflow

- `npm run kuma-server:reload` is the standard human/operator reload path when the managed `kuma-server` surface exists. It must reuse that surface instead of starting a duplicate local daemon.
- `npm run server:reload` remains the raw in-surface/local daemon reload entrypoint on port 4312.
- `npm run server:start` exists as the raw non-reloading entrypoint for scripts, but human/operator workflows should use `server:reload`.
- `npm run kuma-studio:get-selection` reads the latest browser selection.
- `npm run kuma-studio:set-job-status -- --status in_progress --message "..."` updates a job card.
- `npm run kuma-studio:dashboard` opens the studio dashboard in a browser.
- `npm run build:studio` builds the studio-web production bundle.
- `npm test` runs all tests via vitest.
- `kuma-server` is the canonical managed infra surface for this repo when Kuma bootstrap is running; reuse it instead of launching duplicate local daemons in ad hoc terminals.
- Treat `kuma-server` as a managed infra slot: if the daemon process dies but the surface still exists, restart in the same slot and preserve the registry key instead of treating it as disposable.
- Prefer `~/.kuma/cmux/kuma-cmux-project-status.sh kuma-studio` for infra discovery, and use `cmux tree` when you need to verify `kuma-server` directly because `kuma-status` may hide infra pseudo-members.

## Project Structure

- `packages/browser-extension/` -- Chrome extension (Manifest V3, vanilla JS)
- `packages/server/` -- Daemon server (Node.js, WebSocket, port 4312)
- `packages/server/src/studio/` -- Studio-specific modules (stats, events, agent state, image gen)
- `packages/studio-web/` -- Dashboard & Virtual Office (React 19, Vite, Tailwind v4, Zustand)

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

## Dispatch Entry Points

Entry-point layering (intentional, not drift):
- Kuma main thread (Claude) → `kuma-task <worker> ...` + `kuma-dispatch` broker lifecycle directly.
- Background polling/wait helpers are safety nets only and must not become the completion authority.
- Worker / QA / Codex sub-worker → `kuma-task` + `kuma-dispatch ask|reply|complete|fail|qa-pass|qa-reject` directly. CLI is canonical; no slash-skill equivalent exists.

## Conventions

- Server boot/restart is standardized on `npm run kuma-server:reload` for human/operator reuse of shared infra surfaces, and `npm run server:reload` as the raw in-surface/local entrypoint.
- If the managed `kuma-server` surface already exists, restart the daemon there with `npm run kuma-server:reload` instead of starting a second server elsewhere.
- Server code uses `.mjs` (ESM).
- Frontend code uses TypeScript (`.ts`, `.tsx`).
- Browser extension is vanilla JS, no build step.
- WebSocket protocol: `kuma-picker:*` for browser bridge, `kuma-studio:*` for dashboard/office events.
