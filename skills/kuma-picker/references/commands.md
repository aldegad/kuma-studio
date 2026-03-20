# Kuma Picker commands

## Command surface

Kuma Picker state now lives under `~/.codex/kuma-picker/` by default, or under `$CODEX_HOME/kuma-picker/` when `CODEX_HOME` is set. `KUMA_PICKER_STATE_HOME` overrides both.
The shared state home is the primary source of truth.
The command examples below are helper CLI examples for environments that already expose them.

```bash
npm run kuma-pickerd:serve
npm run kuma-pickerd:get-selection
npm run kuma-pickerd:get-selection -- --recent 5
npm run kuma-pickerd:get-selection -- --all
npm run kuma-pickerd:get-job-card
npm run kuma-pickerd:get-browser-session
npm run kuma-pickerd:browser-context -- --url-contains "example.com"
npm run kuma-pickerd:browser-dom -- --url-contains "example.com"
npm run kuma-pickerd:browser-console -- --url-contains "example.com"
npm run kuma-pickerd:browser-debugger-capture -- --url-contains "example.com" --refresh --bypass-cache --capture-ms 4000
npm run kuma-pickerd:browser-click -- --url-contains "example.com" --role tab --exact-text --text "Next"
npm run kuma-pickerd:browser-sequence -- --url-contains "example.com" --steps-file ./tmp/sequence.json
npm run kuma-pickerd:browser-click-point -- --url-contains "example.com" --x 420 --y 360
npm run kuma-pickerd:browser-pointer-drag -- --url-contains "example.com" --from-x 120 --from-y 260 --to-x 420 --to-y 260
npm run kuma-pickerd:browser-fill -- --url-contains "example.com" --label "Site URL" --value "https://example.com/privacy"
npm run kuma-pickerd:browser-key -- --url-contains "example.com" --key Tab
npm run kuma-pickerd:browser-refresh -- --url-contains "example.com"
npm run kuma-pickerd:browser-refresh -- --url-contains "example.com" --bypass-cache
npm run kuma-pickerd:browser-wait-for-text -- --url-contains "example.com" --text "Saved" --scope dialog
npm run kuma-pickerd:browser-query-dom -- --url-contains "example.com" --kind input-by-label --text "Site URL" --scope dialog
npm run kuma-pickerd:browser-screenshot -- --url-contains "example.com" --file ./tmp/current-tab.png
npm run kuma-pickerd:set-job-status -- --status in_progress --message "Implementing the requested change."
npm run kuma-pickerd:set-job-status -- --status completed --message "Updated the picked element and verified the change."
```

## Browser bridge checks

Use these before relying on the Chrome extension bridge:

- `npm run kuma-pickerd:get-browser-session`
- Browser control uses the daemon WebSocket endpoint only.
- If the response is missing, stale, or from the wrong project, start the correct daemon and repoint the extension popup to that daemon URL.
- If the response reports `tabCount > 1`, inspect `tabs[]` and pick the right `activeTabId` or explicit `tabId` before sending browser commands.
- After extension code changes, reload the unpacked extension in `chrome://extensions`.
- After changing the daemon URL in the popup, refresh the target page once so the content script reconnects.

## Browser command targeting

- Always provide `--tab-id`, `--url`, or `--url-contains`.
- Use `--tab-id <id>` when you know the exact Chrome tab id.
- Use `--url <full-url>` for an exact match.
- Use `--url-contains <partial-url>` when query params or hashes are unstable.
- The CLI uses the same `browser-*` commands over the daemon WebSocket bridge.
- Background tabs can answer `browser-context`, `browser-dom`, `browser-console`, `browser-debugger-capture`, and `browser-click`.
- Background tabs can also answer `browser-sequence`, `browser-fill`, `browser-key`, `browser-refresh`, `browser-click-point`, and `browser-pointer-drag`.
- Use `browser-fill --label "..."` when a form field is easier to target by its visible label.
- Use `browser-sequence` when a dropdown or modal workflow should stay alive across multiple steps, and add per-step `assert` checks for postcondition verification.
- Use the wait commands to verify save states instead of guessing from click timing alone.
- Use `browser-query-dom` when a long DOM snapshot is too noisy and you need nearby or required field results.
- Use `browser-console` to inspect recent `console.*`, `window.onerror`, and `unhandledrejection` events after a refresh or action.
- Use `browser-debugger-capture` when page-level logs are not enough and you need `Runtime`, `Log`, or `Network` failures from a short debugger session.
- Use `browser-key` for simple keys like `Tab`, `Enter`, or `Escape`.
- Use `browser-refresh` after deploys or config changes, and add `--bypass-cache` when you need a cache-bypassing reload.
- Use `browser-click-point` when DOM targeting is awkward and viewport coordinates are acceptable.
- Use `browser-pointer-drag` when the UI needs a real drag gesture, such as canvas movement, sliders, or joystick-style controls.
- `browser-screenshot` still requires the target tab to be active and focused.

## Shared state layout

Treat these as shared coordination files under the Kuma Picker state home:

- `dev-selection.json`: latest saved selection
- `dev-selections.json`: session index
- `dev-selections/<session-id>.json`: saved session payload
- `dev-selection-assets/<session-id>/...`: snapshots
- `job-cards.json`: latest browser work-card feed

By default, `get-selection` returns the latest saved selection only.
Use `--recent <n>` for a bounded recent history, or `--all` for the full saved selection collection.

## What to inspect in a selection

Prioritize these fields:

- `page.url`
- `page.title`
- `session.id`
- `element.selector`
- `element.selectorPath`
- `element.rect`
- `element.textPreview`
- `element.outerHTMLSnippet`
- `element.snapshot.assetUrl`
- `elements[]` when the user refers to a numbered pick

## Numbered pick mapping

If the user says `pick 1`, `selection 2`, `see pick3`, or similar:

1. Read the latest selection.
2. Use `elements[index - 1]`.
3. If the index is out of bounds, say so and ask for a new pick.

## Job card workflow

### Pick With Job saved

```bash
npm run kuma-pickerd:get-selection
```

Read `job.message` from the latest selection. The page should already show a `메모 남김` card for that pick.

### During work

```bash
npm run kuma-pickerd:set-job-status -- --status in_progress --message "Implementing the requested change."
```

### Finished

```bash
npm run kuma-pickerd:set-job-status -- --status completed --message "Updated the picked element and verified the change."
```

For extension-first picked UI work, prefer `Pick With Job` plus `set-job-status`.
