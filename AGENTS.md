# Codex Workflow

- `npm run kuma-server:reload` is the standard human/operator reload path when the managed `kuma-server` surface exists. It must reuse that surface instead of starting a duplicate local daemon.
- `npm run server:reload` remains the raw in-surface/local daemon reload entrypoint on port 4312.
- `npm run server:start` exists as the raw non-reloading entrypoint for scripts, but human/operator workflows should use `server:reload`.
- `npm run kuma-studio:get-selection` reads the latest browser selection.
- `npm run kuma-studio:set-job-status -- --status in_progress --message "..."` updates a job card.
- `npm run kuma-studio:dashboard` opens the studio dashboard in a browser.
- `npm run dev:studio` starts the Vite dev server for studio-web.
- `npm run build:studio` builds the studio-web production bundle.
- `npm test` runs all tests via vitest.
- `kuma-server` and `kuma-frontend` are the canonical managed surfaces for this repo when Kuma bootstrap is running; reuse them instead of launching duplicate local servers in ad hoc terminals.
- Treat `kuma-server`/`kuma-frontend` as managed infra slots: if the daemon process dies but the surface still exists, restart in the same slot and preserve the registry key instead of treating it as disposable.
- Prefer `~/.kuma/cmux/kuma-cmux-project-status.sh kuma-studio` for infra discovery, and use `cmux tree` when you need to verify `kuma-server`/`kuma-frontend` directly because `kuma-status` may hide infra pseudo-members.

## Project Structure

- `packages/browser-extension/` -- Chrome extension (Manifest V3, vanilla JS)
- `packages/server/` -- Daemon server (Node.js, WebSocket, port 4312)
- `packages/server/src/studio/` -- Studio-specific modules (stats, events, agent state, image gen)
- `packages/studio-web/` -- Dashboard & Virtual Office (React 19, Vite, Tailwind v4, Zustand)

## Dispatch Entry Points

This repo is not the authority for Kuma-main-thread dispatch. Entry-point layering:
- Kuma main thread (Claude) → `/kuma:dispatch` slash skill (orchestration wrapper only).
- Worker / QA / Codex sub-worker → `kuma-task` + `kuma-dispatch ask|reply|complete|fail|qa-pass|qa-reject` directly.

The CLI is the canonical worker-facing interface, and Phase 4 direct main dispatch uses `kuma-task` / `kuma-dispatch` as the canonical main-thread path as well. No Codex slash-skill equivalent exists or is needed — the split is intentional.

## Conventions

- Server boot/restart is standardized on `npm run kuma-server:reload` for human/operator reuse of shared infra surfaces, and `npm run server:reload` as the raw in-surface/local entrypoint.
- If the managed `kuma-server` surface already exists, restart the daemon there with `npm run kuma-server:reload` instead of starting a second server elsewhere.
- If the managed `kuma-frontend` surface already exists, reuse it for `npm run dev:studio` instead of starting a second Vite dev server elsewhere.
- Managed reload/restart should re-discover and re-register a live `kuma-server`/`kuma-frontend` title surface in the current workspace before giving up on a registry miss.
- Do not create or switch git branches unless the user explicitly instructs it.
- Do not create git worktrees unless the user explicitly instructs it.
- If branch/worktree isolation seems necessary to avoid conflicts, stop and ask for approval first.
- Server code uses `.mjs` (ESM).
- Frontend code uses TypeScript (`.ts`, `.tsx`).
- Browser extension is vanilla JS, no build step.
- WebSocket protocol: `kuma-picker:*` for browser bridge, `kuma-studio:*` for dashboard/office events.
- Use `kuma-picker` first for screenshots, browser inspection, and QA. Use Playwright only when improving Kuma Picker itself or when a task explicitly requires parity/debug work that Kuma Picker cannot do.
