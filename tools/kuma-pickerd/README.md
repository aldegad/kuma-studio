# kuma-pickerd

`kuma-pickerd` is Kuma Picker's local state daemon.

It is responsible for:
- reading and writing `scene.json`
- reading and writing saved selections under `dev-selection*.json`
- storing selection snapshots under `dev-selection-assets/`
- storing shared job-card overlay state under `job-cards.json`
- storing per-session agent notes under `agent-notes/`
- falling back to a shared global picker note when a note is posted before any selection exists
- validating scene payloads
- watching files and publishing SSE updates
- exposing selection and agent note endpoints
- brokering live browser-session presence and browser control commands for the Chrome extension
- providing a CLI for agents and local tooling

The UI reads and writes the scene through the daemon's HTTP/SSE endpoints.
Agents update the same source of truth through the CLI or the shared state files.

## Running the daemon

In the standalone repository:

```bash
npm run kuma-pickerd:serve
```

If you also want the bundled test web, run this in a second terminal:

```bash
npm run dev:web
```

The test web lives under `example/next-host` and provides the bundled Sudoku, chat, and cafe automation surfaces.

Direct CLI usage from the standalone repository:

```bash
node ./packages/server/src/cli.mjs serve --root ./example/next-host
```

In an installed host project, add a root script that points at the vendored CLI path.

`package.json`:

```json
{
  "scripts": {
    "kuma-pickerd:serve": "node ./vendor/kuma-picker/packages/server/src/cli.mjs serve --root ."
  }
}
```

Then run:

```bash
npm run kuma-pickerd:serve
```

Direct CLI usage from an installed host:

```bash
node ./vendor/kuma-picker/packages/server/src/cli.mjs serve --root .
```

The default address is `http://127.0.0.1:4312`.
State files live under `~/.codex/kuma-picker/` by default, or under `$CODEX_HOME/kuma-picker/` when `CODEX_HOME` is set. You can override the location with `KUMA_PICKER_STATE_HOME`.
That directory currently includes:

- `scene.json`
- `dev-selection.json` for the latest saved selection
- `dev-selections.json` for the session collection index
- `dev-selections/<session-id>.json` for each saved selection session
- `dev-selection-assets/<session-id>/...` for saved snapshots
- `agent-notes/<session-id>.json` for shared per-session agent notes
- `job-cards.json` for the recent browser work-card feed
- `browser-extension-status.json` for the latest browser extension presence/status snapshot

`--root` is still accepted for host-relative CLI compatibility, but runtime state now lives in the shared Kuma Picker state home.

## HTTP API

- `GET /health`
- `GET /scene`
- `PATCH /scene/meta`
- `GET /agent-note`
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
- `POST /agent-note`
- `POST /job-card`
- `POST /extension-status`
- `DELETE /agent-note`
- `DELETE /job-card`

## WebSocket API

- `WS /browser-session/socket`

`/health` now reports the active browser transport mode as `browserTransport`.
The default is `websocket`.

Browser control commands such as `browser-context`, `browser-dom`, `browser-console`, `browser-debugger-capture`, `browser-click`,
`browser-sequence`, `browser-fill`, `browser-key`, `browser-refresh`, `browser-click-point`, `browser-screenshot`,
`browser-wait-for-download`, and `browser-get-latest-download`
use the WebSocket control plane.

## CLI examples

Standalone repository:

```bash
node ./packages/server/src/cli.mjs get-scene --root ./example/next-host
node ./packages/server/src/cli.mjs get-selection --root ./example/next-host
node ./packages/server/src/cli.mjs get-selection --root ./example/next-host --recent 5
node ./packages/server/src/cli.mjs get-selection --root ./example/next-host --all
node ./packages/server/src/cli.mjs get-agent-note --root ./example/next-host
node ./packages/server/src/cli.mjs get-job-card --root ./example/next-host
node ./packages/server/src/cli.mjs get-extension-status --root ./example/next-host
node ./packages/server/src/cli.mjs get-browser-session
node ./packages/server/src/cli.mjs set-job-status --root ./example/next-host --status in_progress --message "Implementing the requested UI change."
node ./packages/server/src/cli.mjs set-job-status --root ./example/next-host --status completed --message "Updated the picked element and verified the change."
node ./packages/server/src/cli.mjs set-agent-note --root ./example/next-host --author codex --status fixed --message "Updated the selected element."
node ./packages/server/src/cli.mjs browser-context --url-contains "ddalkkakposting.com"
node ./packages/server/src/cli.mjs browser-dom --url-contains "ddalkkakposting.com"
node ./packages/server/src/cli.mjs browser-console --url-contains "ddalkkakposting.com"
node ./packages/server/src/cli.mjs browser-debugger-capture --url-contains "ddalkkakposting.com" --refresh --bypass-cache --capture-ms 4000
node ./packages/server/src/cli.mjs browser-click --url-contains "ddalkkakposting.com" --role button --exact-text --text "다음"
node ./packages/server/src/cli.mjs browser-sequence --url-contains "ddalkkakposting.com" --steps-file ./tmp/export-sequence.json
node ./packages/server/src/cli.mjs browser-dom --url-contains "developers.portone.io"
node ./packages/server/src/cli.mjs browser-click --url-contains "developers.portone.io" --role button --exact-text --text "다음"
node ./packages/server/src/cli.mjs browser-click-point --url-contains "facebook.com" --x 420 --y 360
node ./packages/server/src/cli.mjs browser-fill --url-contains "facebook.com" --label "사이트 URL" --value "https://ddalkkakposting.com/privacy"
node ./packages/server/src/cli.mjs browser-key --url-contains "facebook.com" --key Tab
node ./packages/server/src/cli.mjs browser-refresh --url-contains "facebook.com"
node ./packages/server/src/cli.mjs browser-refresh --url-contains "facebook.com" --bypass-cache
node ./packages/server/src/cli.mjs browser-wait-for-download --url-contains "facebook.com" --filename-contains ".csv"
node ./packages/server/src/cli.mjs browser-get-latest-download --url-contains "facebook.com" --filename-contains ".csv"
node ./packages/server/src/cli.mjs browser-wait-for-text --url-contains "facebook.com" --text "저장됨" --scope dialog
node ./packages/server/src/cli.mjs browser-wait-for-selector --url-contains "facebook.com" --selector ".toast-success"
node ./packages/server/src/cli.mjs browser-query-dom --url-contains "facebook.com" --kind input-by-label --text "사이트 URL" --scope dialog
node ./packages/server/src/cli.mjs browser-query-dom --url-contains "facebook.com" --kind menu-state --text "설정 모드" --scope dialog
node ./packages/server/src/cli.mjs browser-query-dom --url-contains "facebook.com" --kind tab-state --text "테스트"
node ./packages/server/src/cli.mjs browser-screenshot --url-contains "ddalkkakposting.com" --file ./tmp/current-tab.png
node ./packages/server/src/cli.mjs add-node --root ./example/next-host --id node-welcome-01 --item-id draft-cards-welcomecard --title "Welcome Card" --viewport original --x 120 --y 80 --z-index 1
```

Installed host project:

```bash
node ./vendor/kuma-picker/packages/server/src/cli.mjs get-scene --root .
node ./vendor/kuma-picker/packages/server/src/cli.mjs get-selection --root .
node ./vendor/kuma-picker/packages/server/src/cli.mjs get-selection --root . --recent 5
node ./vendor/kuma-picker/packages/server/src/cli.mjs get-agent-note --root .
node ./vendor/kuma-picker/packages/server/src/cli.mjs get-job-card --root .
node ./vendor/kuma-picker/packages/server/src/cli.mjs get-extension-status --root .
node ./vendor/kuma-picker/packages/server/src/cli.mjs get-browser-session
node ./vendor/kuma-picker/packages/server/src/cli.mjs set-job-status --root . --status in_progress --message "Implementing the requested UI change."
```

For browser commands:

- always provide `--tab-id`, `--url`, or `--url-contains`
- use `--tab-id` for a specific tab when you know the Chrome tab id
- use `--url` for an exact tab URL match
- use `--url-contains` for a looser match when the URL has changing query params
- browser control is routed over the daemon's WebSocket control plane, not the old HTTP polling queue
- use `browser-console` to read recent `console.*`, `window.onerror`, and `unhandledrejection` events from the target page
- use `browser-debugger-capture` when you need short-lived DevTools-level `Runtime`, `Log`, and `Network` diagnostics
- add `--refresh --bypass-cache` to `browser-debugger-capture` for deploy verification and capture the next page-load failures
- use `browser-fill --label "..."` when the form field is easier to target by label than by selector
- use `browser-sequence` when a menu, dropdown, or modal flow must stay alive across multiple clicks
- add per-step `assert` checks in `browser-sequence` to verify that each write actually changed the UI before moving on
- use `browser-wait-for-download` when the action should end in a real downloaded file path
- use `browser-wait-for-text`, `browser-wait-for-text-disappear`, `browser-wait-for-selector`, and `browser-wait-for-dialog-close` to confirm save flows
- use `browser-query-dom` for structured questions such as required fields, nearby inputs, menu state, selected options, tab state, or all textareas
- use `browser-key` for simple keys like `Tab`, `Enter`, or `Escape`
- use `browser-refresh` to reload the target tab after deploys or settings changes
- add `--bypass-cache` to `browser-refresh` when you want a cache-bypassing reload during verification
- use `browser-click-point` when DOM targeting is awkward and viewport coordinates are acceptable
- visible-tab screenshots still require the page to be the active focused tab in Chrome

For saved selections:

- `get-selection` now returns only the latest saved selection by default
- add `--recent <n>` to inspect a bounded recent selection history
- add `--all` only when you truly need the full saved selection collection
- keep `--session-id <id>` for a specific saved selection session
- `Pick With Job` saves a selection with a `job` payload and immediately creates a browser work card in the target tab
- use `set-job-status --status in_progress|completed --message "..."` to update that same card instead of posting a generic note
