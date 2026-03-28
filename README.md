<p align="center">
  <img src="./packages/browser-extension/assets/icons/kuma-picker-icon-128.png" alt="Kuma Picker icon" width="96" height="96" />
</p>

<p align="center">
  <img src="./packages/browser-extension/assets/gestures/kuma-paw-tap.png" alt="Kuma paw tap gesture" width="148" height="148" />
</p>

<h1 align="center">Kuma Picker</h1>

<p align="center">
  Playwright-shaped browser control for agents, with a shared live tab, visible paw-feedback, and zero Playwright runtime dependency.
</p>

<p align="center">
  <code>run</code> · <code>page.locator()</code> · <code>shared selection</code> · <code>job cards</code> · <code>cute but honest</code>
</p>

---

## Why This Exists

Kuma Picker is a Chrome extension plus local daemon for agents that need to work in the same real browser state as a human.

The idea is simple:

- agents already understand Playwright well
- humans benefit from visible, reassuring interaction feedback
- real work often starts from an already-open tab, not a fresh automation browser

So Kuma keeps the browser where it already is, exposes a Playwright-shaped `page` API, and shows a small paw animation when the agent clicks, scrolls, or drags.

It is not trying to be a faster clone of Playwright. It is trying to be a better shared browser surface for human-plus-agent work.

## What You Get

- `run`-based scripting with a small Playwright-shaped API
- no `playwright` package required to use Kuma Picker itself
- shared selection state and job cards for multi-agent coordination
- extension-driven control over the tab you already have open
- visible click, scroll, hold, and drag feedback instead of invisible automation
- bundled test surfaces for smoke, measurement, and parity runs

## Honest Benchmark Snapshot

The current verified parity snapshot is much tighter than before.

Playwright still has the simpler architecture, so it should remain very competitive on raw latency. Kuma still pays for the daemon bridge, extension hop, content script execution, and the visible interaction layer.

What we care about is staying in the same range where Kuma still feels responsive while preserving its product value. After the latest round of overhead cuts, that is now true in attach mode.

Latest verified parity snapshot on **2026-03-29**:

| Scenario | Kuma | Playwright | Result |
| --- | ---: | ---: | --- |
| `agent-chat` | `461ms` | `505ms` | Kuma faster |
| `contenteditable-lab` | `456ms` | `452ms` | Playwright faster |
| `sudoku` | `440ms` | `501ms` | Kuma faster |
| `cafe-control-room` | `595ms` | `583ms` | Playwright faster |
| `shooting` | `1371ms` | `1047ms` | Playwright faster |

Both sides completed these runs at `100%` success, and the parity compare step passed.

This is a `repeat 1`, attach-mode snapshot on the same browser build, not a sweeping claim that Kuma is now universally faster than Playwright.

The benchmark rules are intentionally strict:

- same scenario boundary
- same browser version
- same starting target
- same timeout budget
- same attach mode
- compare step must pass, or the run does not count

See [docs/PLAYWRIGHT-PARITY-BENCHMARK.md](./docs/PLAYWRIGHT-PARITY-BENCHMARK.md) for the rules, commands, and caveats.

## Why Kuma Anyway

Kuma's value is not "we beat Playwright in a stopwatch."

Kuma's value is:

- the agent can work inside the browser session you already have
- the user can see what the agent is doing
- the browser becomes shared coordination state instead of a hidden automation box
- the API still feels familiar because it is shaped like Playwright

The paw feedback is not an excuse for slowness. It is a product choice. We still keep trimming avoidable wait overhead so Kuma stays pleasant to use, and the latest parity run shows that this trade-off no longer means "multi-second by default."

## Getting Started

Fast path:

```bash
node scripts/install.mjs
```

This installs dependencies, starts the daemon, creates shared Kuma Picker state in `~/.kuma-picker/`, installs the active agent skill by default, and explains the one manual step left: loading the unpacked Chrome extension. Add `--all` if you also want to stamp both Codex and Claude skill folders. See [INSTALL.md](./INSTALL.md) for full details.

Manual path:

```bash
npm install
node packages/server/src/cli.mjs serve
```

Then load the unpacked extension from `packages/browser-extension/` in `chrome://extensions` and point the popup at the daemon URL, which defaults to `http://127.0.0.1:4312`.

Health check:

```bash
node scripts/doctor.mjs
```

Bundled test web:

```bash
npm run dev:web
```

## Quick Example

```js
await page.goto("http://localhost:3000/agent-chat");
await page.getByLabel("1P Composer").fill("hello from kuma");
await page.getByRole("button", { name: "Send from 1P" }).click();
console.log(await page.getByText("hello from kuma").textContent());
```

## Common Commands

- `npm run kuma-pickerd:serve`
- `npm run kuma-pickerd:get-selection`
- `npm run kuma-pickerd:get-job-card`
- `npm run kuma-pickerd:get-extension-status`
- `npm run kuma-pickerd:get-browser-session`
- `npm run kuma-pickerd:run -- --url-contains "localhost:3000" ./tmp/script.js`
- `npm run kuma-pickerd:smoke -- --scenario agent-chat`
- `npm run kuma-pickerd:measure -- --tab-id 123 --repeat 3`
- `npm run kuma-pickerd:parity:kuma -- --url-contains "localhost:3000" --browser-version "146.0.7680.165" --repeat 3`
- `npm run kuma-pickerd:parity:playwright -- --cdp-url "http://127.0.0.1:9222" --url-contains "localhost:3000" --browser-version "146.0.7680.165" --playwright-module-path /tmp/kuma-picker-parity-playwright/node_modules/playwright/index.mjs --repeat 3`
- `npm run kuma-pickerd:parity:compare -- --kuma ./artifacts/parity/kuma.json --playwright ./artifacts/parity/playwright.json`
- `npm run test`

`playwright` is **not** a runtime dependency of Kuma Picker. It is only needed when you want to run the Playwright side of a parity comparison.

## Repository Layout

- `packages/browser-extension/`: unpacked Chrome extension that bridges arbitrary pages into `kuma-pickerd`
- `packages/server/`: `kuma-pickerd` entrypoint shim
- `tools/kuma-pickerd/`: local daemon and shared-state implementation
- `example/next-host/`: bundled test web for smoke, measurement, and parity flows

## Agent Workflow

Kuma Picker has a shared selection and job-card model so multiple coding agents can coordinate through the same browser state.

- latest selection: `npm run kuma-pickerd:get-selection`
- latest work card: `npm run kuma-pickerd:get-job-card`
- browser extension status: `npm run kuma-pickerd:get-extension-status`
- update work card: `npm run kuma-pickerd:set-job-status -- --status in_progress --message "..."`

Agent-specific guidance:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [GEMINI.md](./GEMINI.md)

## Docs

- [docs/BROWSER-CONTROL-CHECKLIST.md](./docs/BROWSER-CONTROL-CHECKLIST.md)
- [docs/PLAYWRIGHT-PARITY-BENCHMARK.md](./docs/PLAYWRIGHT-PARITY-BENCHMARK.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/kuma-pickerd/README.md](./tools/kuma-pickerd/README.md)
- [packages/browser-extension/README.md](./packages/browser-extension/README.md)

## Acknowledgements

The Playwright-shaped scripting direction and some of the agent ergonomics work in Kuma Picker were informed by [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser).

## License

[Apache-2.0](./LICENSE)

The current repository state is distributed under Apache License 2.0. Earlier published revisions may have been available under different terms.
