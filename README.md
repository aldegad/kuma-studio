<p align="center">
  <img src="./packages/browser-extension/assets/icons/kuma-picker-icon-128.png" alt="Kuma Picker icon" width="96" height="96" />
</p>

# Kuma Picker

Kuma Picker is a browser extension and local daemon for visual UI selection bridging with coding agents. Use the Chrome extension to pick elements on any page and coordinate work through `kuma-pickerd`.

## Domains

- `packages/browser-extension/`: unpacked Chrome extension that bridges arbitrary pages into `kuma-pickerd`
- `packages/server/`: `kuma-pickerd` entrypoint shim
- `tools/kuma-pickerd/`: local state daemon implementation

## Getting Started

```bash
npm install
npm run kuma-pickerd:serve
```

Load the unpacked extension from `packages/browser-extension/` in `chrome://extensions`, then point the extension popup at the running daemon URL (default `http://127.0.0.1:4312`).

## Agent Workflow

Kuma Picker has a shared selection and note model so multiple coding agents can coordinate.

- latest selection: `npm run kuma-pickerd:get-selection`
- latest note: `npm run kuma-pickerd:get-agent-note`
- browser extension status: `npm run kuma-pickerd:get-extension-status`
- update note: `npm run kuma-pickerd:set-agent-note -- --author codex --status in_progress --message "..."`

Agent-specific guidance lives here:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [GEMINI.md](./GEMINI.md)

## Common Commands

- `npm run kuma-pickerd:serve`: start the local daemon
- `npm run kuma-pickerd:get-selection`: read the latest saved selection
- `npm run kuma-pickerd:get-agent-note`: read the latest agent note
- `npm run kuma-pickerd:get-extension-status`: show the latest browser extension heartbeat
- `npm run kuma-pickerd:get-browser-session`: check browser bridge session
- `npm run kuma-pickerd:browser-context`: get browser context from extension
- `npm run kuma-pickerd:browser-dom`: read DOM from extension
- `npm run kuma-pickerd:browser-click -- --text "Next"`: click element via extension
- `npm run kuma-pickerd:browser-screenshot -- --file ./tmp/shot.png`: take screenshot via extension
- `npm run test`: run daemon unit tests

## Docs

- [docs/maintainers.md](./docs/maintainers.md)
- [tools/kuma-pickerd/README.md](./tools/kuma-pickerd/README.md)
- [packages/browser-extension/README.md](./packages/browser-extension/README.md)

## License

[MIT](./LICENSE)
