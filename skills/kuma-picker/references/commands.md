# Kuma Picker commands

All commands use the CLI directly:

```bash
node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs <command> [args]
```

Shorthand used below: `kuma-cli` = `node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs`

## State home resolution

1. `KUMA_PICKER_STATE_HOME` — explicit override (highest priority)
2. `~/.kuma-picker/` — shared default for Claude and Codex

## Command examples

```bash
kuma-cli serve
kuma-cli get-selection
kuma-cli get-selection --recent 5
kuma-cli get-selection --all
kuma-cli get-job-card
kuma-cli get-extension-status
kuma-cli get-browser-session
kuma-cli run ./tmp/script.js --url-contains "example.com"
npm run kuma-pickerd:smoke -- --scenario agent-chat
npm run kuma-pickerd:measure -- --scenario agent-chat --tab-id 123 --repeat 3
npm run kuma-pickerd:parity:kuma -- --url-contains "localhost:3000" --browser-version "146.0.7680.165" --repeat 3
npm run kuma-pickerd:parity:playwright -- --cdp-url "http://127.0.0.1:9222" --url-contains "localhost:3000" --browser-version "146.0.7680.165" --playwright-module-path /tmp/kuma-picker-parity-playwright/node_modules/playwright/index.mjs --repeat 3
npm run kuma-pickerd:parity:compare -- --kuma ./artifacts/parity/kuma.json --playwright ./artifacts/parity/playwright.json
kuma-cli set-job-status --status in_progress --message "Implementing the requested change."
kuma-cli set-job-status --status completed --message "Updated the picked element and verified the change."
```

Example `run` script:

```js
await page.goto("http://localhost:3000/agent-chat");
await page.getByLabel("1P Composer").fill("hello from kuma");
await page.getByRole("button", { name: "Send from 1P" }).click();
console.log(await page.getByText("hello from kuma").textContent());
```

## Browser bridge checks

- `kuma-cli get-browser-session`
- Browser control uses the daemon WebSocket endpoint only.
- If missing or stale, start the daemon and repoint the extension popup.
- If `tabCount > 1`, inspect `tabs[]` and pick the right `tabId`.
- After extension code changes, reload the unpacked extension in `chrome://extensions`.

## Browser run targeting

- `run` requires `--tab-id`, `--url`, or `--url-contains`.
- Use `--tab-id` when you know the exact Chrome tab id.
- Use `--url` for an exact tab URL match.
- Use `--url-contains` when query params or path segments are unstable.
- Keep write and verification in the same script when possible.
- Prefer `page.locator`, `page.getByRole`, and `page.getByLabel` over brittle text-only flows.
- Use `page.waitForSelector` or locator readback after writes instead of assuming success.
- Use `locator.boundingBox()` when a canvas or drag surface needs viewport coordinates without relying on `page.evaluate`.
- Prefer the bundled smoke scripts in `scripts/run/` when they already cover the requested bundled surface.
- `Playwright` is not needed for normal Kuma work. It is only needed when you explicitly run the Playwright side of a parity benchmark.

## Measurement vs parity

- `kuma-pickerd:measure` is Kuma-only and does not count as Playwright parity evidence by itself.
- Fair parity requires both sides to run shared scenarios and then pass `kuma-pickerd:parity:compare`.

## Shared state layout

Under the state home:

- `dev-selection.json`: latest saved selection
- `dev-selections.json`: session index
- `dev-selections/<session-id>.json`: saved session payload
- `dev-selection-assets/<session-id>/...`: snapshots
- `job-cards.json`: latest browser work-card feed

By default, `get-selection` returns the latest only. Use `--recent <n>` or `--all`.

## What to inspect in a selection

- `page.url`, `page.title`
- `session.id`
- `element.selector`, `element.selectorPath`, `element.rect`
- `element.textPreview`, `element.outerHTMLSnippet`
- `element.snapshot.assetUrl`
- `elements[]` when the user refers to a numbered pick

## Numbered pick mapping

If the user says `pick 1`, `selection 2`, etc.:
1. Read the latest selection.
2. Use `elements[index - 1]`.
3. If out of bounds, say so and ask for a new pick.

## Job card workflow

### Pick With Job saved
```bash
kuma-cli get-selection
```
Read `job.message`. The page should already show a visible note card.

### Leave a manual handoff for the user

Use `Pick With Job` when the agent is blocked on a user-only browser step such as a password, 2FA prompt, CAPTCHA, approval toggle, or judgment call. Write the exact manual step in the job message so it stays attached to the page.

Good examples:

```text
Enter the password here and click the sign-in button. When you're done, call me back.
Please confirm whether this setting should be enabled. After deciding, call me back.
```

### During work
```bash
kuma-cli set-job-status --status in_progress --message "Implementing the requested change."
```

### Finished
```bash
kuma-cli set-job-status --status completed --message "Updated the picked element and verified the change."
```
