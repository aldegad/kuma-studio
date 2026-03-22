<p align="center">
  <img src="./packages/browser-extension/assets/icons/kuma-picker-icon-128.png" alt="Kuma Picker icon" width="96" height="96" />
</p>

# Kuma Picker

Kuma Picker is a browser extension and local daemon for visual UI selection bridging with coding agents. Use the Chrome extension to pick elements on any page and coordinate work through `kuma-pickerd`.
The repo also ships a bundled Next.js test web under `example/next-host` for browser automation smoke tests. The older design-lab and local embedding workflow are intentionally out of scope.

## Domains

- `packages/browser-extension/`: unpacked Chrome extension that bridges arbitrary pages into `kuma-pickerd`
- `packages/server/`: `kuma-pickerd` entrypoint shim
- `tools/kuma-pickerd/`: local state daemon implementation
- `example/next-host/`: bundled test web with Sudoku, chat, cafe, and shooting flows for extension-driven testing

## Getting Started

The fastest way to set up everything:

```bash
node scripts/install.mjs
```

This installs dependencies, starts the daemon, installs the global skills for both Codex and Claude (`~/.codex/skills/kuma-picker/`, `~/.claude/skills/kuma-picker/`), and tells you the one remaining step (loading the Chrome extension). See [INSTALL.md](./INSTALL.md) for details.

**Manual setup** (if you prefer step by step):

```bash
npm install
node packages/server/src/cli.mjs serve
```

Load the unpacked extension from `packages/browser-extension/` in `chrome://extensions`, then point the extension popup at the running daemon URL (default `http://127.0.0.1:4312`).

**Health check:**

```bash
node scripts/doctor.mjs
```

If you want the bundled test web too, run this in a second terminal:

```bash
npm run dev:web
```

## Agent Workflow

Kuma Picker has a shared selection and job-card model so multiple coding agents can coordinate.

- latest selection: `npm run kuma-pickerd:get-selection`
- latest work card: `npm run kuma-pickerd:get-job-card`
- browser extension status: `npm run kuma-pickerd:get-extension-status`
- update work card: `npm run kuma-pickerd:set-job-status -- --status in_progress --message "..."`

Agent-specific guidance lives here:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [GEMINI.md](./GEMINI.md)

## Common Commands

- `npm run kuma-pickerd:serve`: start the local daemon
- `npm run dev:web`: start the bundled test web
- `npm run build:web`: build the bundled test web
- `npm run typecheck:web`: typecheck the bundled test web
- `npm run kuma-pickerd:get-selection`: read the latest saved selection
- `npm run kuma-pickerd:get-job-card`: read the latest browser work card
- `npm run kuma-pickerd:get-extension-status`: show the latest browser extension heartbeat
- `npm run kuma-pickerd:get-browser-session`: check browser bridge session
- `npm run kuma-pickerd:browser-context`: get browser context from extension
- `npm run kuma-pickerd:browser-navigate -- --url "http://localhost:3000"`: navigate the current browser session to a URL
- `npm run kuma-pickerd:browser-dom`: read DOM from extension
- `npm run kuma-pickerd:browser-click -- --text "Next"`: click element via extension
- `npm run kuma-pickerd:browser-pointer-drag -- --from-x 120 --from-y 260 --to-x 420 --to-y 260`: drag across the page via extension
- `npm run kuma-pickerd:browser-screenshot -- --file ./tmp/shot.png`: take screenshot via extension
- `npm run test`: run daemon unit tests

## Docs

- [docs/BROWSER-CONTROL-CHECKLIST.md](./docs/BROWSER-CONTROL-CHECKLIST.md)
- [docs/PLAYWRIGHT-PARITY-BENCHMARK.md](./docs/PLAYWRIGHT-PARITY-BENCHMARK.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/kuma-pickerd/README.md](./tools/kuma-pickerd/README.md)
- [packages/browser-extension/README.md](./packages/browser-extension/README.md)

## License

[MIT](./LICENSE)
