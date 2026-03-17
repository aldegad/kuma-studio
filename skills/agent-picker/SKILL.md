---
name: agent-picker
description: Read the latest Agent Picker selection, screenshot, shared note state, and browser bridge status before working on picked UI or browser-driven investigation. Use when a repo exposes `agent-pickerd:*` scripts, when the user mentions Agent Picker, a picked element, a saved selection, browser extension control, tab inspection, DOM reads, clicks, screenshots, or shorthand like "check pick 1", and when work should start from `.agent-picker/` shared coordination state.
---

# Agent Picker

Use Agent Picker as a shared coordination workflow, not a private scratchpad.

## Core workflow

1. Find the command surface.
   - Prefer host-root `agent-pickerd:*` scripts in installed projects.
   - In the standalone Agent Picker repo, use the root scripts that target `example/next-host`.
2. Read the latest selection before doing anything else.
   - Default command: `npm run agent-pickerd:get-selection`
3. If work begins from a saved selection, acknowledge the shared note.
   - Default command:
     `npm run agent-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."`
4. Interpret the selection.
   - Read the page URL/title, selected element metadata, and snapshot reference.
   - If the user references `pick 1`, `selection 2`, or similar, map the number to `elements[]` using 1-based indexing.
5. Work from that saved context.
   - Update the shared note as progress changes.
6. Before the final reply, leave a final note if code changed for the picked element.

## Browser bridge workflow

Use this when the user wants the Agent Picker Chrome extension to inspect a live tab.

1. Check the browser bridge session first.
   - Default command: `npm run agent-pickerd:get-browser-session`
2. If the session is missing or stale, fix the bridge before continuing.
   - Start the current daemon for this repo or host.
   - Reload the Chrome extension after extension code changes.
   - In the extension popup, point the daemon URL at the currently running daemon.
3. Prefer targeted tab commands when the user may switch away from the page.
   - Use `--tab-id`, `--url`, or `--url-contains` for background-tab DOM reads and clicks.
4. Use the narrowest browser command that answers the question.
   - `npm run agent-pickerd:browser-context`
   - `npm run agent-pickerd:browser-dom`
   - `npm run agent-pickerd:browser-click -- --text "Next"`
   - `npm run agent-pickerd:browser-fill -- --value "https://example.com/privacy"`
   - `npm run agent-pickerd:browser-key -- --key Tab`
   - `npm run agent-pickerd:browser-click-point -- --x 420 --y 360`
   - `npm run agent-pickerd:browser-screenshot -- --file ./tmp/current-tab.png`
5. Remember the current limitation.
   - DOM reads and clicks can target background tabs.
   - Visible-tab screenshots still require the target tab to be the active focused tab in Chrome.

## Note statuses

- `acknowledged`: selection was read and triage started
- `in_progress`: active investigation or implementation is happening
- `fixed`: work is done and verified enough to hand back
- `needs_reselect`: saved selection is stale, too broad, or no longer matches the UI/code path

## Selection hygiene

- Treat `.agent-picker/dev-selection.json` and `.agent-picker/agent-notes/*.json` as shared state.
- Do not clear notes unless they would mislead the next agent.
- Prefer `needs_reselect` over guessing when the saved element no longer matches the current UI.

## Command and state details

Read [references/commands.md](references/commands.md) when you need:
- standalone vs installed-host command examples
- the `.agent-picker/` file layout
- what fields to inspect inside the saved selection payload
- examples of when reselection is required
