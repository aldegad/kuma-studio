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

This installs dependencies, starts the daemon, creates the shared Kuma Picker state in `~/.kuma-picker/`, installs the active agent skill by default, and tells you the one remaining step (loading the Chrome extension). Add `--all` if you want to stamp both the Codex and Claude skill folders in one run. See [INSTALL.md](./INSTALL.md) for details.

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
- `npm run kuma-pickerd:run -- --url-contains "localhost:3000" ./tmp/script.js`: run a Playwright-shaped script against a target tab
- `npm run kuma-pickerd:smoke -- --scenario agent-chat`: run a reusable smoke scenario against the bundled test surfaces
- `npm run kuma-pickerd:measure -- --tab-id 123 --repeat 3`: run repeated Kuma-side scenario measurements and save a JSON report
- `npm run kuma-pickerd:parity:kuma -- --url-contains "localhost:3000" --browser-version "146.0.7680.165" --repeat 3`: produce a parity-format Kuma attach run
- `npm run kuma-pickerd:parity:playwright -- --cdp-url "http://127.0.0.1:9222" --url-contains "localhost:3000" --browser-version "146.0.7680.165" --playwright-module-path /tmp/kuma-picker-parity-playwright/node_modules/playwright/index.mjs --repeat 3`: produce a parity-format Playwright attach run
- `npm run kuma-pickerd:parity:compare -- --kuma ./artifacts/parity/kuma.json --playwright ./artifacts/parity/playwright.json`: verify that two parity runs are actually comparable
- `npm run test`: run daemon unit tests

Example runner script:

```js
await page.goto("http://localhost:3000/agent-chat");
await page.getByLabel("1P Composer").fill("hello from kuma");
await page.getByRole("button", { name: "Send from 1P" }).click();
console.log(await page.getByText("hello from kuma").textContent());
```

## Docs

- [docs/BROWSER-CONTROL-CHECKLIST.md](./docs/BROWSER-CONTROL-CHECKLIST.md)
- [docs/PLAYWRIGHT-PARITY-BENCHMARK.md](./docs/PLAYWRIGHT-PARITY-BENCHMARK.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/kuma-pickerd/README.md](./tools/kuma-pickerd/README.md)
- [packages/browser-extension/README.md](./packages/browser-extension/README.md)

## License

[Apache-2.0](./LICENSE)

The current repository state is distributed under Apache License 2.0. Earlier
published revisions may have been available under different terms.
