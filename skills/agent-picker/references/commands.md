# Agent Picker commands

## Command surface

Use the narrowest stable command surface available in the current project.

### Installed host project

Prefer host-root wrapper scripts:

```bash
npm run agent-pickerd:serve
npm run agent-pickerd:get-selection
npm run agent-pickerd:get-agent-note
npm run agent-pickerd:get-browser-session
npm run agent-pickerd:browser-context
npm run agent-pickerd:browser-dom
npm run agent-pickerd:browser-click -- --text "Next"
npm run agent-pickerd:browser-click-point -- --x 420 --y 360
npm run agent-pickerd:browser-fill -- --value "https://example.com/privacy"
npm run agent-pickerd:browser-key -- --key Tab
npm run agent-pickerd:browser-screenshot -- --file ./tmp/current-tab.png
npm run agent-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."
npm run agent-pickerd:clear-agent-note
```

### Standalone Agent Picker repository

Use the repo-root scripts, which target `example/next-host`:

```bash
npm run agent-pickerd:serve
npm run agent-pickerd:get-selection
npm run agent-pickerd:get-agent-note
npm run agent-pickerd:get-browser-session
npm run agent-pickerd:browser-context
npm run agent-pickerd:browser-dom
npm run agent-pickerd:browser-click -- --text "Next"
npm run agent-pickerd:browser-click-point -- --x 420 --y 360
npm run agent-pickerd:browser-fill -- --value "https://example.com/privacy"
npm run agent-pickerd:browser-key -- --key Tab
npm run agent-pickerd:browser-screenshot -- --file ./tmp/current-tab.png
npm run agent-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."
npm run agent-pickerd:clear-agent-note
```

## Browser bridge checks

Use these before relying on the Chrome extension bridge:

- `npm run agent-pickerd:get-browser-session`
- If the response is missing, stale, or from the wrong project, start the correct daemon and repoint the extension popup to that daemon URL.
- After extension code changes, reload the unpacked extension in `chrome://extensions`.
- After changing the daemon URL in the popup, refresh the target page once so the content script reconnects.

## Browser command targeting

- Omit targeting flags to use the active focused tab.
- Use `--tab-id <id>` when you know the exact Chrome tab id.
- Use `--url <full-url>` for an exact match.
- Use `--url-contains <partial-url>` when query params or hashes are unstable.
- Background tabs can answer `browser-context`, `browser-dom`, and `browser-click`.
- Background tabs can also answer `browser-fill`, `browser-key`, and `browser-click-point`.
- Use `browser-fill` to set an exact value in a focused or targeted field.
- Use `browser-key` for simple keys like `Tab`, `Enter`, or `Escape`.
- Use `browser-click-point` when DOM targeting is awkward and viewport coordinates are acceptable.
- `browser-screenshot` still requires the target tab to be active and focused.

## Shared state layout

Treat these as shared coordination files:

- `.agent-picker/dev-selection.json`: latest saved selection
- `.agent-picker/dev-selections.json`: session index
- `.agent-picker/dev-selections/<session-id>.json`: saved session payload
- `.agent-picker/dev-selection-assets/<session-id>/...`: snapshots
- `.agent-picker/agent-notes/<session-id>.json`: shared agent notes

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

## Shared note workflow

### Start

```bash
npm run agent-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."
```

### During work

```bash
npm run agent-pickerd:set-agent-note -- --author codex --status in_progress --message "Implementing the requested change."
```

### Finished

```bash
npm run agent-pickerd:set-agent-note -- --author codex --status fixed --message "Updated the picked element and verified the change."
```

### Reselect needed

```bash
npm run agent-pickerd:set-agent-note -- --author codex --status needs_reselect --message "The saved selection no longer matches the current UI."
```

## Use `needs_reselect` when

- the screenshot no longer matches the current screen
- the selector path points to a stale or generic node
- the picked element is too broad to safely act on
- the relevant UI moved to a different route or panel
- the saved selection came from a different session than the user means
