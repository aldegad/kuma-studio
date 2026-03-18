# Browser Extension MVP

This folder contains an unpacked Chrome extension that bridges arbitrary web
pages into a local `agent-pickerd` daemon.

## What It Does

- saves the current page as the latest Agent Picker selection
- offers a lightweight inspect mode so you can click a single element or drag a viewport area on any site
- captures a visible-tab screenshot and stores it through the shared Agent Picker state flow

This MVP does not try to map DOM nodes back to app source code or React
components. It is meant to prove the bridge model on real websites first.

The extension keeps a lightweight bootstrap content script on regular pages so
the daemon can see the current tab context, and loads the heavier inspect UI
only when you explicitly start picking from the popup.

It now also exposes a WebSocket-backed browser control bridge for local agents:

- stream live tab presence into the daemon while the page stays open
- return page context and a DOM snapshot of visible interactive elements
- click a target by selector, selector path, or visible text
- click a viewport coordinate, fill focused or targeted form fields, and send basic keys
- capture a visible-tab screenshot to a file through the CLI

It can also target a non-active tab for DOM reads and clicks when you specify
`--tab-id`, `--url`, or `--url-contains`. Visible-tab screenshots still require
the page to be the currently focused tab.

## Load It In Chrome

1. start a local daemon
2. open `chrome://extensions`
3. enable `Developer mode`
4. click `Load unpacked`
5. choose one of these folders:

```text
packages/browser-extension
~/.codex/extensions/agent-picker-browser-extension
```

If you installed Agent Picker with `npm run skill:install`, prefer the `~/.codex/extensions/agent-picker-browser-extension` copy so Chrome can keep using a stable global path.
That core install does not add any files to your app repo, and it does not enable the experimental embedded picker/provider mode by default.

## Start The Bridge

From the standalone repo root:

```bash
npm run agent-pickerd:serve
```

That gives the extension a stable default bridge at:

```text
http://127.0.0.1:4312
```

## Use It

1. open any regular website tab
2. open the extension popup
3. leave the daemon URL at `http://127.0.0.1:4312` or paste your custom one
4. click `Test Bridge`
5. click `Capture Current Page` or `Pick Element Or Drag Area`
6. read the latest saved context from the repo root:

```bash
npm run agent-pickerd:get-selection
```

To check whether the daemon has seen this extension recently, run:

```bash
npm run agent-pickerd:get-extension-status
```

To inspect or control the active tab from a local agent, keep the target page
open and use the daemon CLI with an explicit tab target:

```bash
node ./packages/server/src/cli.mjs get-browser-session
node ./packages/server/src/cli.mjs browser-context --url-contains "developers.portone.io"
node ./packages/server/src/cli.mjs browser-dom --url-contains "developers.portone.io"
node ./packages/server/src/cli.mjs browser-click --url-contains "developers.portone.io" --role tab --exact-text --text "API 개별 연동"
node ./packages/server/src/cli.mjs browser-dom --url-contains "developers.portone.io"
node ./packages/server/src/cli.mjs browser-click --url-contains "developers.portone.io" --role button --exact-text --text "다음"
node ./packages/server/src/cli.mjs browser-click-point --url-contains "facebook.com" --x 420 --y 360
node ./packages/server/src/cli.mjs browser-fill --url-contains "facebook.com" --label "사이트 URL" --value "https://ddalkkakposting.com/privacy"
node ./packages/server/src/cli.mjs browser-key --url-contains "facebook.com" --key Tab
node ./packages/server/src/cli.mjs browser-wait-for-text --url-contains "facebook.com" --text "저장됨" --scope dialog
node ./packages/server/src/cli.mjs browser-query-dom --url-contains "facebook.com" --kind input-by-label --text "사이트 URL" --scope dialog
node ./packages/server/src/cli.mjs browser-screenshot --url-contains "developers.portone.io" --file ./tmp/portone.png
```

## Notes

- browser-internal pages such as `chrome://...` will not accept the content script
- screenshots are captured from the visible viewport, not the entire scrollable page
- dragged area captures are cropped from the visible viewport screenshot before they are saved
- the extension talks to the same daemon and state files as the embedded provider mode
- selection saves still use the daemon's HTTP endpoints, but browser control uses the daemon's WebSocket endpoint at `/browser-session/socket`
- extension status remains best-effort presence data: the daemon can tell whether the extension was seen recently, not guarantee that Chrome still has it loaded if the last status becomes stale
- the popup `Test Bridge` action now separates daemon health from WebSocket readiness so startup errors are easier to diagnose
- targeted DOM and click commands can run against background tabs as long as the tab stays open with the content script loaded
- targeted `browser-fill`, `browser-key`, and `browser-click-point` commands can also run against background tabs when the page remains open
- screenshots still require the target page to be the visible focused tab in Chrome
- the legacy HTTP polling transport is no longer the default path; it is kept only as an internal debug escape hatch behind `AGENT_PICKER_TRANSPORT=legacy-poll`
