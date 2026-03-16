# Browser Extension MVP

This folder contains an unpacked Chrome extension that bridges arbitrary web
pages into a local `agent-pickerd` daemon.

## What It Does

- saves the current page as the latest Agent Picker selection
- offers a lightweight inspect mode so you can click a single element or drag a viewport area on any site
- captures a visible-tab screenshot and stores it through the existing
  `.agent-picker/dev-selection*` flow

This MVP does not try to map DOM nodes back to app source code or React
components. It is meant to prove the bridge model on real websites first.

## Load It In Chrome

1. start a local daemon
2. open `chrome://extensions`
3. enable `Developer mode`
4. click `Load unpacked`
5. choose this folder:

```text
packages/browser-extension
```

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

## Notes

- browser-internal pages such as `chrome://...` will not accept the content script
- screenshots are captured from the visible viewport, not the entire scrollable page
- dragged area captures are cropped from the visible viewport screenshot before they are saved
- the extension talks to the same daemon and state files as the embedded provider mode
- extension status is heartbeat-based: the daemon can tell whether the extension was seen recently, not guarantee that Chrome still has it loaded if the last heartbeat is stale
