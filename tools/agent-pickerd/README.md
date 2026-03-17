# agent-pickerd

`agent-pickerd` is Agent Picker's local state daemon.

It is responsible for:
- reading and writing `scene.json`
- reading and writing saved selections under `dev-selection*.json`
- storing selection snapshots under `dev-selection-assets/`
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
npm run dev
```

That starts both the bundled example host and the daemon with a matched URL/port configuration.

If you want only the daemon:

```bash
npm run agent-pickerd:serve
```

Direct CLI usage from the standalone repository:

```bash
node ./packages/server/src/cli.mjs serve --root ./example/next-host
```

In an installed host project, add a root script that points at the vendored CLI path.

`package.json`:

```json
{
  "scripts": {
    "agent-pickerd:serve": "node ./vendor/agent-picker/packages/server/src/cli.mjs serve --root ."
  }
}
```

Then run:

```bash
npm run agent-pickerd:serve
```

Direct CLI usage from an installed host:

```bash
node ./vendor/agent-picker/packages/server/src/cli.mjs serve --root .
```

The default address is `http://127.0.0.1:4312`.
State files live under `~/.codex/agent-picker/` by default, or under `$CODEX_HOME/agent-picker/` when `CODEX_HOME` is set. You can override the location with `AGENT_PICKER_STATE_HOME`.
That directory currently includes:

- `scene.json`
- `dev-selection.json` for the latest saved selection
- `dev-selections.json` for the session collection index
- `dev-selections/<session-id>.json` for each saved selection session
- `dev-selection-assets/<session-id>/...` for saved snapshots
- `agent-notes/<session-id>.json` for shared per-session agent notes
- `browser-extension-status.json` for the latest browser extension presence/status snapshot

`--root` is still accepted for host-relative CLI compatibility, but runtime state now lives in the shared Agent Picker state home.

## HTTP API

- `GET /health`
- `GET /scene`
- `PATCH /scene/meta`
- `GET /agent-note`
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
- `POST /extension-status`
- `DELETE /agent-note`

## WebSocket API

- `WS /browser-session/socket`

`/health` now reports the active browser transport mode as `browserTransport`.
The default is `websocket`.

Browser control commands such as `browser-context`, `browser-dom`, `browser-click`,
`browser-fill`, `browser-key`, `browser-click-point`, and `browser-screenshot`
use the WebSocket control plane by default.

The older HTTP command queue endpoints still exist only as an internal escape
hatch when you explicitly set:

```bash
AGENT_PICKER_TRANSPORT=legacy-poll
```

Without that env flag, the deprecated HTTP browser queue endpoints return `410`.

## CLI examples

Standalone repository:

```bash
node ./packages/server/src/cli.mjs get-scene --root ./example/next-host
node ./packages/server/src/cli.mjs get-selection --root ./example/next-host
node ./packages/server/src/cli.mjs get-agent-note --root ./example/next-host
node ./packages/server/src/cli.mjs get-extension-status --root ./example/next-host
node ./packages/server/src/cli.mjs get-browser-session
node ./packages/server/src/cli.mjs set-agent-note --root ./example/next-host --author codex --status fixed --message "Updated the selected element."
node ./packages/server/src/cli.mjs browser-context --url-contains "ddalkkakposting.com"
node ./packages/server/src/cli.mjs browser-dom --url-contains "ddalkkakposting.com"
node ./packages/server/src/cli.mjs browser-click --url-contains "ddalkkakposting.com" --text "다음"
node ./packages/server/src/cli.mjs browser-dom --url-contains "developers.portone.io"
node ./packages/server/src/cli.mjs browser-click --url-contains "developers.portone.io" --text "다음"
node ./packages/server/src/cli.mjs browser-click-point --url-contains "facebook.com" --x 420 --y 360
node ./packages/server/src/cli.mjs browser-fill --url-contains "facebook.com" --label "사이트 URL" --value "https://ddalkkakposting.com/privacy"
node ./packages/server/src/cli.mjs browser-key --url-contains "facebook.com" --key Tab
node ./packages/server/src/cli.mjs browser-wait-for-text --url-contains "facebook.com" --text "저장됨" --scope dialog
node ./packages/server/src/cli.mjs browser-wait-for-selector --url-contains "facebook.com" --selector ".toast-success"
node ./packages/server/src/cli.mjs browser-query-dom --url-contains "facebook.com" --kind nearby-input --text "사이트 URL" --scope dialog
node ./packages/server/src/cli.mjs browser-screenshot --url-contains "ddalkkakposting.com" --file ./tmp/current-tab.png
node ./packages/server/src/cli.mjs add-node --root ./example/next-host --id node-welcome-01 --item-id draft-cards-welcomecard --title "Welcome Card" --viewport original --x 120 --y 80 --z-index 1
```

Installed host project:

```bash
node ./vendor/agent-picker/packages/server/src/cli.mjs get-scene --root .
node ./vendor/agent-picker/packages/server/src/cli.mjs get-selection --root .
node ./vendor/agent-picker/packages/server/src/cli.mjs get-agent-note --root .
node ./vendor/agent-picker/packages/server/src/cli.mjs get-extension-status --root .
node ./vendor/agent-picker/packages/server/src/cli.mjs get-browser-session
node ./vendor/agent-picker/packages/server/src/cli.mjs set-agent-note --root . --author codex --status fixed --message "Updated the selected element."
```

For browser commands:

- always provide `--tab-id`, `--url`, or `--url-contains`
- use `--tab-id` for a specific tab when you know the Chrome tab id
- use `--url` for an exact tab URL match
- use `--url-contains` for a looser match when the URL has changing query params
- browser control is routed over the daemon's WebSocket control plane, not the old HTTP polling queue
- use `browser-fill --label "..."` when the form field is easier to target by label than by selector
- use `browser-wait-for-text`, `browser-wait-for-text-disappear`, `browser-wait-for-selector`, and `browser-wait-for-dialog-close` to confirm save flows
- use `browser-query-dom` for structured questions such as required fields, nearby inputs, or all textareas
- use `browser-key` for simple keys like `Tab`, `Enter`, or `Escape`
- use `browser-click-point` when DOM targeting is awkward and viewport coordinates are acceptable
- visible-tab screenshots still require the page to be the active focused tab in Chrome
