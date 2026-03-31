# Claude Workflow

- `npm run kuma-studio:serve` starts the daemon server on port 4312.
- `npm run kuma-studio:get-selection` reads the latest browser selection.
- `npm run kuma-studio:set-job-status -- --status in_progress --message "..."` updates a job card.
- `npm run kuma-studio:dashboard` opens the studio dashboard in a browser.
- `npm run dev:studio` starts the Vite dev server for studio-web.
- `npm run build:studio` builds the studio-web production bundle.
- `npm test` runs all tests via vitest.

## Project Structure

- `packages/browser-extension/` -- Chrome extension (Manifest V3, vanilla JS)
- `packages/server/` -- Daemon server (Node.js, WebSocket, port 4312)
- `packages/server/src/studio/` -- Studio-specific modules (stats, events, agent state, image gen)
- `packages/studio-web/` -- Dashboard & Virtual Office (React 19, Vite, Tailwind v4, Zustand)

## Conventions

- Server code uses `.mjs` (ESM).
- Frontend code uses TypeScript (`.ts`, `.tsx`).
- Browser extension is vanilla JS, no build step.
- WebSocket protocol: `kuma-picker:*` for browser bridge, `kuma-studio:*` for dashboard/office events.
