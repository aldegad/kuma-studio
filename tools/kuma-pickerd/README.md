# kuma-pickerd

`kuma-pickerd` is Kuma Picker's local daemon and browser automation broker.

## Responsibilities

- store shared selections, snapshots, scenes, and job cards
- expose HTTP/SSE endpoints for scene and selection state
- track browser-session presence from the extension
- broker Playwright-shaped automation over `WS /browser-session/socket`
- provide the CLI used by agents and local tooling

## Run it

```bash
npm run kuma-pickerd:serve
```

If you also want the bundled test surfaces:

```bash
npm run dev:web
```

Default daemon URL: `http://127.0.0.1:4312`

Default state home: `~/.kuma-picker/`

## Primary CLI surface

```bash
node ./packages/server/src/cli.mjs get-selection
node ./packages/server/src/cli.mjs get-job-card
node ./packages/server/src/cli.mjs get-extension-status
node ./packages/server/src/cli.mjs get-browser-session
node ./packages/server/src/cli.mjs set-job-status --status in_progress --message "Investigating the picked UI."
node ./packages/server/src/cli.mjs run ./tmp/script.js --url-contains "localhost:3000"
npm run kuma-pickerd:smoke -- --scenario agent-chat
npm run kuma-pickerd:measure -- --scenario shooting --tab-id 123 --repeat 5
npm run kuma-pickerd:parity:kuma -- --url-contains "localhost:3000" --browser-version "146.0.7680.165" --repeat 3
npm run kuma-pickerd:parity:playwright -- --cdp-url "http://127.0.0.1:9222" --url-contains "localhost:3000" --browser-version "146.0.7680.165" --playwright-module-path /tmp/kuma-picker-parity-playwright/node_modules/playwright/index.mjs --repeat 3
npm run kuma-pickerd:parity:compare -- --kuma ./artifacts/parity/kuma.json --playwright ./artifacts/parity/playwright.json
```

You can also pipe scripts through stdin:

```bash
cat <<'EOF' | node ./packages/server/src/cli.mjs run --url-contains "localhost:3000"
await page.goto("http://localhost:3000/agent-chat");
await page.getByLabel("1P Composer").fill("hello from kuma");
await page.getByRole("button", { name: "Send from 1P" }).click();
console.log(await page.getByText("hello from kuma").textContent());
EOF
```

## Supported automation model

`run` injects:

- `page`
- `console`

The supported API is a deliberate Playwright-shaped subset:

- `page.goto`, `page.reload`, `page.url`, `page.title`, `page.screenshot`, `page.evaluate`
- `page.locator`, `page.getByText`, `page.getByRole`, `page.getByLabel`, `page.waitForSelector`
- `page.keyboard.press|down|up`
- `page.mouse.move|down|up|drag`
- `locator.click|fill|press|textContent|inputValue|isVisible|waitFor|screenshot`
- `locator.boundingBox`

Unsupported APIs hard-fail. There are no compatibility shims for the removed `browser-*` command surface.

## Reusable smoke scenarios

Bundled smoke scripts live under `scripts/run/`.

- `agent-chat.smoke.js`
- `contenteditable-lab.smoke.js`
- `sudoku.smoke.js`
- `cafe-control-room.smoke.js`
- `shooting.smoke.js`

Run them through:

```bash
npm run kuma-pickerd:smoke
npm run kuma-pickerd:smoke -- --scenario sudoku
```

## Repeated measurements

Use the measurement runner when you want repeated Kuma-side timings and a saved JSON report:

```bash
npm run kuma-pickerd:measure -- --tab-id 123 --repeat 3
npm run kuma-pickerd:measure -- --scenario shooting --tab-id 123 --repeat 5
```

By default, reports are written under `artifacts/measurements/`.

## Fair parity runs

For real Kuma vs Playwright comparisons, use the parity runners instead of the Kuma-only measurement runner.

```bash
npm run kuma-pickerd:parity:kuma -- --url-contains "localhost:3000" --browser-version "146.0.7680.165" --repeat 3
npm run kuma-pickerd:parity:playwright -- --cdp-url "http://127.0.0.1:9222" --url-contains "localhost:3000" --browser-version "146.0.7680.165" --playwright-module-path /tmp/kuma-picker-parity-playwright/node_modules/playwright/index.mjs --repeat 3
npm run kuma-pickerd:parity:compare -- --kuma ./artifacts/parity/kuma.json --playwright ./artifacts/parity/playwright.json
```

The comparison command hard-fails if the mode, base URL, timeout budget, repeat count, scenario set, repo commit, resolved target URL, or browser metadata do not match.

## HTTP API

- `GET /health`
- `GET /scene`
- `PATCH /scene/meta`
- `GET /job-card`
- `GET /browser-session`
- `GET /extension-status`
- `GET /events`
- `PUT /scene`
- `POST /scene/nodes`
- `PATCH /scene/nodes/:id`
- `DELETE /scene/nodes/:id`
- `GET /dev-selection`
- `GET /dev-selection/assets/:sessionId/:fileName`
- `POST /dev-selection`
- `DELETE /dev-selection`
- `DELETE /dev-selection/session?sessionId=...`
- `POST /job-card`
- `POST /extension-status`
- `DELETE /job-card`

## State files

The shared state home contains:

- `scene.json`
- `dev-selection.json`
- `dev-selections.json`
- `dev-selections/<session-id>.json`
- `dev-selection-assets/<session-id>/...`
- `job-cards.json`
- `browser-extension-status.json`

`get-selection` returns the latest saved selection by default. Use `--recent <n>` or `--all` only when needed.
