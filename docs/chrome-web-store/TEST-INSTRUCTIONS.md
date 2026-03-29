# Chrome Web Store Test Instructions

These instructions are for Chrome Web Store reviewers testing Kuma Picker.

## What Kuma Picker is

Kuma Picker is a local-first Chrome extension that lets a user pick UI from a real browser tab, attach a job card, and run a Playwright-shaped automation subset through a local daemon.

The extension is not a hosted SaaS client. It is expected to talk to a local Kuma Picker daemon on the review machine.

## Local setup

1. Clone the repository:

```bash
git clone https://github.com/aldegad/kuma-picker.git
cd kuma-picker
```

2. Install dependencies:

```bash
npm install
```

3. Start the local daemon:

```bash
node ./packages/server/src/cli.mjs serve
```

Default daemon URL:

- `http://127.0.0.1:4312`

4. Load the extension build in Chrome.

## Basic review flow

1. Open any normal website tab such as:
   - `https://example.com`
   - or the bundled local example app if desired
2. Open the Kuma Picker extension popup.
3. Confirm the bridge connects and the current page becomes ready.
4. Click **Pick Element Or Drag Area**.
5. In the page:
   - click an element to save it, or
   - drag an area to save it, or
   - press `Space` to preview the whole page, then click to save it
6. Confirm the selection is saved to the local bridge.

## Job card flow

1. Open the popup.
2. Click **Pick With Job**.
3. Pick an element or area.
4. Enter a short job message.
5. Confirm the on-page job card appears.

## Optional automation flow

With the daemon running, Kuma Picker also supports the local script runner:

```bash
cat <<'EOF' | node ./packages/server/src/cli.mjs run --url-contains "example.com"
console.log(await page.title());
EOF
```

This uses the extension runtime in the live tab and does not require installing the Playwright package for the normal Kuma workflow.

## Why the permissions are needed

- `tabs`, `activeTab`, `scripting`: target and instrument the selected page
- `<all_urls>`: users can pick from arbitrary pages
- `storage`: persist local extension settings
- `debugger`: optional diagnostic and inspection features
- `tabCapture`, `desktopCapture`, `offscreen`, `downloads`, `contentSettings`: optional live capture and recording flows started by the user

## What data goes where

- page selections, screenshots, and job cards are sent to the local Kuma Picker daemon
- default local daemon URL: `http://127.0.0.1:4312`
- no Kuma-operated hosted backend receives browsing data from the extension
