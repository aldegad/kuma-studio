# Kuma Picker commands

All commands use the CLI directly:

```bash
node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs <command> [args]
```

Shorthand used below: `kuma-cli` = `node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs`

## State home resolution

1. `KUMA_PICKER_STATE_HOME` — explicit override (highest priority)
2. `$CODEX_HOME/kuma-picker/` — when `CODEX_HOME` is set
3. `~/.codex/kuma-picker/` — default

## Command examples

```bash
kuma-cli serve
kuma-cli get-selection
kuma-cli get-selection --recent 5
kuma-cli get-selection --all
kuma-cli get-job-card
kuma-cli get-browser-session
kuma-cli browser-context --url-contains "example.com"
kuma-cli browser-navigate --url "http://localhost:3000"
kuma-cli browser-navigate --url "http://localhost:3001" --new-tab
kuma-cli browser-navigate --tab-id 123456 --url "http://localhost:3000"
kuma-cli browser-dom --url-contains "example.com"
kuma-cli browser-eval --url-contains "example.com" --expression "document.title"
kuma-cli browser-console --url-contains "example.com"
kuma-cli browser-debugger-capture --url-contains "example.com" --refresh --bypass-cache --capture-ms 4000
kuma-cli browser-click --url-contains "example.com" --role tab --exact-text --text "Next"
kuma-cli browser-sequence --url-contains "example.com" --steps-file ./tmp/sequence.json
kuma-cli browser-click-point --url-contains "example.com" --x 420 --y 360
kuma-cli browser-pointer-drag --url-contains "example.com" --from-x 120 --from-y 260 --to-x 420 --to-y 260
kuma-cli browser-fill --url-contains "example.com" --label "Site URL" --value "https://example.com/privacy"
kuma-cli browser-key --url-contains "example.com" --key Tab
kuma-cli browser-key --url-contains "example.com" --key ArrowLeft --hold-ms 400
kuma-cli browser-keydown --url-contains "example.com" --selector "[data-testid='chat-input-1p']" --meta --key a
kuma-cli browser-keyup --url-contains "example.com" --selector "[data-testid='chat-input-1p']" --meta --key a
kuma-cli browser-mousedown --url-contains "example.com" --x 320 --y 460
kuma-cli browser-mousemove --url-contains "example.com" --x 420 --y 460
kuma-cli browser-mouseup --url-contains "example.com" --x 420 --y 460
kuma-cli browser-query-dom --url-contains "example.com" --kind selector-state --selector "[data-testid='chat-input-1p']"
kuma-cli browser-sequence --url-contains "example.com" --steps '[{"type":"fill","selector":"[data-testid=\"chat-input-1p\"]","value":"hello","assert":{"type":"selector-state","selector":"[data-testid=\"chat-input-1p\"]","value":"hello","focused":true}}]'
kuma-cli browser-sequence --url-contains "example.com" --steps '[{"type":"fill","selector":"[data-testid=\"editor\"]","value":"Line 1\nLine 2"},{"type":"key","key":"Enter"},{"type":"insertText","text":"Line 3","assert":{"type":"selector-state","selector":"[data-testid=\"editor\"]","value":"Line 1\nLine 2\nLine 3"}}]'
kuma-cli browser-refresh --url-contains "example.com"
kuma-cli browser-refresh --url-contains "example.com" --bypass-cache
kuma-cli browser-screenshot --tab-id 123 --file ./tmp/current-tab.png --restore-previous-active-tab
kuma-cli browser-wait-for-text --url-contains "example.com" --text "Saved" --scope dialog
kuma-cli browser-query-dom --url-contains "example.com" --kind input-by-label --text "Site URL" --scope dialog
kuma-cli browser-screenshot --url-contains "example.com" --file ./tmp/current-tab.png
kuma-cli set-job-status --status in_progress --message "Implementing the requested change."
kuma-cli set-job-status --status completed --message "Updated the picked element and verified the change."
```

## Browser bridge checks

- `kuma-cli get-browser-session`
- Browser control uses the daemon WebSocket endpoint only.
- If missing or stale, start the daemon and repoint the extension popup.
- If `tabCount > 1`, inspect `tabs[]` and pick the right `tabId`.
- After extension code changes, reload the unpacked extension in `chrome://extensions`.

## Browser command targeting

- `browser-navigate` requires `--url` as the destination. Add `--tab-id` to reuse a tab, `--new-tab` to open a new one.
- All other browser commands need `--tab-id`, `--url`, or `--url-contains`.
- Background tabs support `browser-context`, `browser-dom`, `browser-console`, `browser-debugger-capture`, `browser-click`, `browser-sequence`, `browser-fill`, `browser-key`, `browser-refresh`, `browser-click-point`, and `browser-pointer-drag`.
- Use `browser-fill --label "..."` for form fields by visible label.
- Use `browser-eval --expression "..."` for small page-context readbacks.
- Use `browser-sequence` with per-step `assert` for multi-step workflows.
- Use `browser-query-dom --kind selector-state` for focused state, value, or selection range readbacks.
- Use `browser-console` for recent `console.*`, `window.onerror`, and `unhandledrejection` events.
- Use `browser-debugger-capture` for `Runtime`, `Log`, or `Network` failures from a short debugger session.
- Use `browser-key --hold-ms <ms>` for sustained input.
- Use `browser-keydown`/`browser-keyup` for modifier chords.
- Use `browser-mousedown`/`browser-mousemove`/`browser-mouseup` for low-level pointer phases.
- Use `browser-pointer-drag` for real drag gestures.
- Screenshots require the target tab to be active. Add `--restore-previous-active-tab` to yield focus back.

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
Read `job.message`. The page should already show a `메모 남김` card.

### During work
```bash
kuma-cli set-job-status --status in_progress --message "Implementing the requested change."
```

### Finished
```bash
kuma-cli set-job-status --status completed --message "Updated the picked element and verified the change."
```
