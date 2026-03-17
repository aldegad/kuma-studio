# Agent Picker commands

## Command surface

Use the narrowest stable command surface available in the current project.
Agent Picker state now lives under `~/.codex/agent-picker/` by default, or under `$CODEX_HOME/agent-picker/` when `CODEX_HOME` is set. `AGENT_PICKER_STATE_HOME` overrides both.
When installed with `npm run skill:install`, the unpacked Chrome extension is copied to `~/.codex/extensions/agent-picker-browser-extension`, or to `$CODEX_HOME/extensions/agent-picker-browser-extension` when `CODEX_HOME` is set.

### Installed host project

Prefer host-root wrapper scripts:

```bash
npm run agent-pickerd:serve
npm run agent-pickerd:get-selection
npm run agent-pickerd:get-agent-note
npm run agent-pickerd:get-browser-session
npm run agent-pickerd:browser-context -- --url-contains "example.com"
npm run agent-pickerd:browser-dom -- --url-contains "example.com"
npm run agent-pickerd:browser-click -- --url-contains "example.com" --role tab --exact-text --text "Next"
npm run agent-pickerd:browser-click-point -- --url-contains "example.com" --x 420 --y 360
npm run agent-pickerd:browser-fill -- --url-contains "example.com" --label "Site URL" --value "https://example.com/privacy"
npm run agent-pickerd:browser-key -- --url-contains "example.com" --key Tab
npm run agent-pickerd:browser-wait-for-text -- --url-contains "example.com" --text "Saved" --scope dialog
npm run agent-pickerd:browser-query-dom -- --url-contains "example.com" --kind input-by-label --text "Site URL" --scope dialog
npm run agent-pickerd:browser-screenshot -- --url-contains "example.com" --file ./tmp/current-tab.png
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
npm run agent-pickerd:browser-context -- --url-contains "example.com"
npm run agent-pickerd:browser-dom -- --url-contains "example.com"
npm run agent-pickerd:browser-click -- --url-contains "example.com" --role tab --exact-text --text "Next"
npm run agent-pickerd:browser-click-point -- --url-contains "example.com" --x 420 --y 360
npm run agent-pickerd:browser-fill -- --url-contains "example.com" --label "Site URL" --value "https://example.com/privacy"
npm run agent-pickerd:browser-key -- --url-contains "example.com" --key Tab
npm run agent-pickerd:browser-wait-for-text -- --url-contains "example.com" --text "Saved" --scope dialog
npm run agent-pickerd:browser-query-dom -- --url-contains "example.com" --kind nearby-input --text "Site URL" --scope dialog
npm run agent-pickerd:browser-screenshot -- --url-contains "example.com" --file ./tmp/current-tab.png
npm run agent-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."
npm run agent-pickerd:clear-agent-note
```

## Browser bridge checks

Use these before relying on the Chrome extension bridge:

- `npm run agent-pickerd:get-browser-session`
- Browser control uses the daemon WebSocket endpoint by default. Treat `AGENT_PICKER_TRANSPORT=legacy-poll` as a temporary debug-only escape hatch, not the normal setup.
- If the response is missing, stale, or from the wrong project, start the correct daemon and repoint the extension popup to that daemon URL.
- If the response reports `tabCount > 1`, inspect `tabs[]` and pick the right `activeTabId` or explicit `tabId` before sending browser commands.
- After extension code changes, reload the unpacked extension in `chrome://extensions`.
- After changing the daemon URL in the popup, refresh the target page once so the content script reconnects.

## Browser command targeting

- Always provide `--tab-id`, `--url`, or `--url-contains`.
- Use `--tab-id <id>` when you know the exact Chrome tab id.
- Use `--url <full-url>` for an exact match.
- Use `--url-contains <partial-url>` when query params or hashes are unstable.
- The CLI still uses the same `browser-*` commands, but they are now transported over WebSocket instead of the deprecated HTTP polling queue.
- Background tabs can answer `browser-context`, `browser-dom`, and `browser-click`.
- Background tabs can also answer `browser-fill`, `browser-key`, and `browser-click-point`.
- Use `browser-fill --label "..."` when a form field is easier to target by its visible label.
- Use the wait commands to verify save states instead of guessing from click timing alone.
- Use `browser-query-dom` when a long DOM snapshot is too noisy and you need nearby or required field results.
- Use `browser-key` for simple keys like `Tab`, `Enter`, or `Escape`.
- Use `browser-click-point` when DOM targeting is awkward and viewport coordinates are acceptable.
- `browser-screenshot` still requires the target tab to be active and focused.

## Shared state layout

Treat these as shared coordination files under the Agent Picker state home:

- `dev-selection.json`: latest saved selection
- `dev-selections.json`: session index
- `dev-selections/<session-id>.json`: saved session payload
- `dev-selection-assets/<session-id>/...`: snapshots
- `agent-notes/<session-id>.json`: shared agent notes

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
