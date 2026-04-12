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
- Prefer `~/.kuma/bin/kuma-status` or `~/.kuma/cmux/kuma-cmux-project-status.sh kuma-studio` to discover existing managed surfaces before starting server/frontend processes.

## Project Structure

- `packages/browser-extension/` -- Chrome extension (Manifest V3, vanilla JS)
- `packages/server/` -- Daemon server (Node.js, WebSocket, port 4312)
- `packages/server/src/studio/` -- Studio-specific modules (stats, events, agent state, image gen)
- `packages/studio-web/` -- Dashboard & Virtual Office (React 19, Vite, Tailwind v4, Zustand)

## Conventions

- Server boot/restart is standardized on `npm run kuma-server:reload` for human/operator reuse of shared infra surfaces, and `npm run server:reload` as the raw in-surface/local entrypoint.
- If the managed `kuma-server` surface already exists, restart the daemon there with `npm run kuma-server:reload` instead of starting a second server elsewhere.
- If the managed `kuma-frontend` surface already exists, reuse it for `npm run dev:studio` instead of starting a second Vite dev server elsewhere.
- Server code uses `.mjs` (ESM).
- Frontend code uses TypeScript (`.ts`, `.tsx`).
- Browser extension is vanilla JS, no build step.
- WebSocket protocol: `kuma-picker:*` for browser bridge, `kuma-studio:*` for dashboard/office events.
- Use `kuma-picker` first for screenshots, browser inspection, and QA. Use Playwright only when improving Kuma Picker itself or when a task explicitly requires parity/debug work that Kuma Picker cannot do.
