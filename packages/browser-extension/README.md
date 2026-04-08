# Browser Extension

This folder contains the unpacked Chrome extension that connects arbitrary pages to the local `kuma-pickerd` daemon.

## What it does

- saves the current page or picked element into Kuma Picker shared state
- renders the inspect UI and job-card overlay flows
- streams browser-session presence to the daemon
- executes the Playwright-shaped automation subset used by `kuma-pickerd run`
- keeps gesture overlays for click, scroll, hold, and drag interactions

## Load it in Chrome

1. start the daemon with `npm run server:reload`
2. open `chrome://extensions`
3. enable `Developer mode`
4. click `Load unpacked`
5. choose `packages/browser-extension`

## Bridge usage

Keep the target page open, then run:

```bash
node ./packages/server/src/cli.mjs get-browser-session
cat <<'EOF' | node ./packages/server/src/cli.mjs run --url-contains "localhost:3000"
await page.goto("http://localhost:3000/cafe-control-room");
await page.getByRole("tab", { name: "Delivery" }).click();
await page.getByRole("button", { name: "Prepare Receipts CSV" }).click();
console.log(await page.title());
EOF
```

## Notes

- browser-internal pages such as `chrome://...` do not accept the content script
- screenshots are visible-viewport captures, not full-page stitched images
- `Pick With Job` still creates the three-step work card flow on the target page
- browser automation is now WebSocket-only and script-runner-only
- background-tab automation works when the tab remains open with the content runtime attached
