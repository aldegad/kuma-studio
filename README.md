<p align="center">
  <img src="./packages/browser-extension/assets/icons/kuma-picker-icon-128.png" alt="Kuma Picker icon" width="96" height="96" />
</p>

<p align="center">
  <img src="./packages/browser-extension/assets/gestures/kuma-paw-tap.png" alt="Kuma paw tap gesture" width="148" height="148" />
</p>

<h1 align="center">Kuma Picker</h1>

<p align="center">
  The human picks. The agent sees. The paw taps.<br />
  A shared browser surface for human-plus-agent work.
</p>

<p align="center">
  <code>pick & job cards</code> · <code>visible paw feedback</code> · <code>Playwright-shaped API</code> · <code>your real browser</code>
</p>

<p align="center">
  <a href="https://github.com/aldegad/kuma-picker/actions/workflows/ci.yml">
    <img src="https://github.com/aldegad/kuma-picker/actions/workflows/ci.yml/badge.svg" alt="CI status" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 license" />
  </a>
</p>

---

## Playwright Can Drive a Browser. Kuma Shares One.

Playwright opens an isolated browser, runs a script, and tears it down. Kuma Picker walks into **the browser you already have open** — your tabs, your cookies, your scroll position — and works right there, next to you.

### Pick an Element, Hand It to the Agent

You **pick** an element on the page — a button, a form, a broken layout — and the agent instantly gets the selector, bounding box, text content, and full page context. Attach a job note ("fix this layout," "translate this card") and the agent picks it up, updates a work card to `in_progress`, and marks `completed` when it's done.

A conversation loop through the live browser, not a one-way script.

### Watch the Paw

When the agent clicks, a bear paw taps the screen. When it scrolls, the paw drags. When it holds, the paw presses down. You always see where the agent is and what it just did.

### Playwright-Shaped API

```js
await page.goto(url);
await page.getByRole("button", { name: "Send" }).click();
await page.getByLabel("Email").fill("hello@example.com");
```

No `playwright` package required. Same mental model, but running in your real browser.

## Kuma vs Playwright

| | Kuma Picker | Playwright |
| --- | --- | --- |
| Browser | Your real tabs, cookies, state | Isolated instance |
| Human input | Pick elements, attach jobs | None |
| Visibility | Paw animations on every action | Invisible |
| Coordination | Shared selection + job cards | Not built-in |
| API shape | Playwright-compatible subset | Full Playwright API |
| Runtime dep | None | `playwright` package |
| Multi-agent | Shared state home | Separate processes |

## Benchmark

Attach mode, `repeat 1`, **2026-03-29**:

| Scenario | Kuma | Playwright | |
| --- | ---: | ---: | --- |
| `agent-chat` | `461ms` | `505ms` | Kuma |
| `contenteditable-lab` | `456ms` | `452ms` | Playwright |
| `sudoku` | `440ms` | `501ms` | Kuma |
| `cafe-control-room` | `595ms` | `583ms` | Playwright |
| `shooting` | `1371ms` | `1047ms` | Playwright |

100% success both sides. [Full benchmark rules](./docs/PLAYWRIGHT-PARITY-BENCHMARK.md).

## Getting Started

```bash
node scripts/install.mjs
```

Installs deps, starts the daemon, creates `~/.kuma-picker/`, and sets up the agent skill. The one manual step: load the unpacked Chrome extension from `packages/browser-extension/`. See [INSTALL.md](./INSTALL.md).

Manual path:

```bash
npm install
node packages/server/src/cli.mjs serve
```

Health check:

```bash
node scripts/doctor.mjs
```

## Quick Example

```js
await page.goto("http://localhost:3000/agent-chat");
await page.getByLabel("1P Composer").fill("hello from kuma");
await page.getByRole("button", { name: "Send from 1P" }).click();
console.log(await page.getByText("hello from kuma").textContent());
```

## Commands

```
npm run kuma-pickerd:serve
npm run kuma-pickerd:get-selection
npm run kuma-pickerd:get-job-card
npm run kuma-pickerd:get-browser-session
npm run kuma-pickerd:run -- --url-contains "localhost:3000" ./tmp/script.js
npm run kuma-pickerd:smoke -- --scenario agent-chat
npm run kuma-pickerd:measure -- --tab-id 123 --repeat 3
npm run test
```

Parity commands: see [docs/PLAYWRIGHT-PARITY-BENCHMARK.md](./docs/PLAYWRIGHT-PARITY-BENCHMARK.md).

## Layout

- `packages/browser-extension/` — Chrome extension
- `packages/server/` — daemon entrypoint
- `tools/kuma-pickerd/` — daemon + shared-state implementation
- `example/next-host/` — bundled test web

## Agent Workflow

- `get-selection` — latest picked element
- `get-job-card` — latest work card
- `set-job-status -- --status in_progress --message "..."` — update work card

Agent-specific docs: [AGENTS.md](./AGENTS.md) · [CLAUDE.md](./CLAUDE.md) · [GEMINI.md](./GEMINI.md)

## Docs

[Browser Control Checklist](./docs/BROWSER-CONTROL-CHECKLIST.md) · [Parity Benchmark](./docs/PLAYWRIGHT-PARITY-BENCHMARK.md) · [Maintainers](./docs/maintainers.md) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Code of Conduct](./CODE_OF_CONDUCT.md)

## Acknowledgements

Scripting direction informed by [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser).

## License

[Apache-2.0](./LICENSE)
