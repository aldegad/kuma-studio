---
name: kuma-picker
description: Read the latest Kuma Picker selection, screenshot, shared note state, and browser bridge status before working on picked UI or browser-driven investigation. Use when a repo exposes `kuma-pickerd:*` scripts, when the user mentions Kuma Picker, a picked element, a saved selection, browser extension control, tab inspection, DOM reads, clicks, screenshots, or shorthand like "check pick 1", and when work should start from the shared Kuma Picker state home.
---

# Kuma Picker

Use Kuma Picker as a shared coordination workflow, not a private scratchpad.

## Core workflow

1. Find the command surface.
   - Look for `kuma-pickerd:*` scripts in the project's `package.json`.
   - Do not tell the user "this repo doesn't have `kuma-pickerd:*` scripts" unless you actually checked the root `package.json` or ran the command and saw it fail.
2. Read the latest selection before doing anything else.
   - Default command: `npm run kuma-pickerd:get-selection`
   - This now returns only the latest saved selection by default.
   - Use `npm run kuma-pickerd:get-selection -- --recent 5` only when you need a bounded recent history.
   - Use `npm run kuma-pickerd:get-selection -- --all` only when the user explicitly needs the full saved selection collection.
3. If work begins from a saved selection, acknowledge the shared note.
   - Default command:
     `npm run kuma-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."`
4. Interpret the selection.
   - Read the page URL/title, selected element metadata, and snapshot reference.
   - Prefer values you can verify from the repo, the current page, the saved selection, or `browser-*` commands before asking the user for them.
   - If the user references `pick 1`, `selection 2`, or similar, map the number to `elements[]` using 1-based indexing.
5. Work from that saved context.
   - Update the shared note as progress changes.
6. Before the final reply, leave a final note if code changed for the picked element.

## Browser bridge workflow

Use this when the user wants the Kuma Picker Chrome extension to inspect a live tab.

1. Check the browser bridge session first.
   - Default command: `npm run kuma-pickerd:get-browser-session`
   - Read `activeTabId`, `tabCount`, and `tabs[]` when multiple Chrome windows or tabs are open.
   - Prefer saying what you are checking right now over narrating a hypothetical blocker. For example: "I'll read the current browser session first."
2. If the session is missing or stale, fix the bridge before continuing.
   - Start the daemon with `npm run kuma-pickerd:serve`.
   - Reload the Chrome extension after extension code changes.
   - In the extension popup, point the daemon URL at the currently running daemon.
   - Browser control uses the daemon WebSocket bridge only.
   - If you are blocked, name the exact command you ran and the concrete failure. Do not replace that with a generic line about needing to "find where to launch the bridge command."
3. Prefer targeted tab commands when the user may switch away from the page.
   - Use `--tab-id`, `--url`, or `--url-contains` for background-tab DOM reads and clicks.
   - When `get-browser-session` reports more than one live tab, prefer `--tab-id` from that summary instead of relying on the current active tab.
4. Use the narrowest targeted browser command that answers the question.
   - `npm run kuma-pickerd:browser-context -- --url-contains "example.com"`
   - `npm run kuma-pickerd:browser-dom -- --url-contains "example.com"`
   - `npm run kuma-pickerd:browser-console -- --url-contains "example.com"`
   - `npm run kuma-pickerd:browser-debugger-capture -- --url-contains "example.com" --refresh --bypass-cache --capture-ms 4000`
   - `npm run kuma-pickerd:browser-click -- --url-contains "example.com" --role tab --exact-text --text "Next"`
   - `npm run kuma-pickerd:browser-sequence -- --url-contains "example.com" --steps-file ./tmp/sequence.json`
   - `npm run kuma-pickerd:browser-fill -- --url-contains "example.com" --label "Site URL" --value "https://example.com/privacy"`
   - `npm run kuma-pickerd:browser-key -- --url-contains "example.com" --key Tab`
   - `npm run kuma-pickerd:browser-refresh -- --url-contains "example.com"`
   - `npm run kuma-pickerd:browser-refresh -- --url-contains "example.com" --bypass-cache`
   - `npm run kuma-pickerd:browser-click-point -- --url-contains "example.com" --x 420 --y 360`
   - `npm run kuma-pickerd:browser-wait-for-text -- --url-contains "example.com" --text "Saved" --scope dialog`
   - `npm run kuma-pickerd:browser-query-dom -- --url-contains "example.com" --kind input-by-label --text "Site URL" --scope dialog`
   - `npm run kuma-pickerd:browser-screenshot -- --url-contains "example.com" --file ./tmp/current-tab.png`
5. Remember the current limitation.
   - DOM reads and clicks can target background tabs.
   - Screenshots will focus the requested target tab first, so prefer `--tab-id` or a precise URL target before capturing.

## Browser write safety

- Never infer success from a click alone.
- After any write action, verify the persisted state with a direct readback.
- Prefer `browser-sequence` with per-step `assert` checks when menus or modal states can disappear between separate commands.
- Prefer selector, role, and label targeting over text-only clicks when duplicate text may exist.
- Use point clicks only after semantic targeting fails.

## Note statuses

- `acknowledged`: selection was read and triage started
- `in_progress`: active investigation or implementation is happening
- `fixed`: work is done and verified enough to hand back
- `needs_reselect`: saved selection is stale, too broad, or no longer matches the UI/code path

## Selection hygiene

- Treat `~/.codex/kuma-picker/` or `$CODEX_HOME/kuma-picker/` as shared state unless `KUMA_PICKER_STATE_HOME` overrides it.
- Do not clear notes unless they would mislead the next agent.
- Prefer `needs_reselect` over guessing when the saved element no longer matches the current UI.

## Response guardrails

- Do not invent setup problems before checking the repo and command output.
- When you need a bridge or daemon, state the exact next command you are about to run instead of a reusable fallback speech.
- If a command is unavailable, include the specific checked path or command in your explanation.

## Command and state details

Read [references/commands.md](references/commands.md) when you need:
- command examples
- the shared Kuma Picker state layout
- what fields to inspect inside the saved selection payload
- examples of when reselection is required
