---
name: agent-picker
description: Read the latest Agent Picker selection, screenshot, shared note state, and browser bridge status before working on picked UI or browser-driven investigation. Use when a repo exposes `agent-pickerd:*` scripts, when the user mentions Agent Picker, a picked element, a saved selection, browser extension control, tab inspection, DOM reads, clicks, screenshots, or shorthand like "check pick 1", and when work should start from the shared Agent Picker state home.
---

# Agent Picker

Use Agent Picker as a shared coordination workflow, not a private scratchpad.

## Prerequisites — run once after skill registration

If `~/.codex/extensions/agent-picker-browser-extension/manifest.json` does not exist, the browser extension has not been installed yet. Run the following from the agent-picker repo:

```bash
npm run extension:install          # copies the unpacked extension
# or, to install both skill files and extension together:
npm run skill:install
```

Then load the unpacked extension in Chrome:
`chrome://extensions` → Developer mode → Load unpacked → `~/.codex/extensions/agent-picker-browser-extension`

Skip this section if the extension is already loaded in Chrome.

## Core workflow

1. Find the command surface.
   - Prefer host-root `agent-pickerd:*` scripts in installed projects.
   - In the standalone Agent Picker repo, use the root scripts that target `example/next-host`.
   - In this standalone repo, root `agent-pickerd:*` scripts are expected to exist in the root `package.json`.
   - Before saying scripts are missing, verify the root script list first. Do not guess from memory.
   - Do not tell the user "this repo doesn't have `agent-pickerd:*` scripts" unless you actually checked the root `package.json` or ran the command and saw it fail.
2. Read the latest selection before doing anything else.
   - Default command: `npm run agent-pickerd:get-selection`
3. If work begins from a saved selection, acknowledge the shared note.
   - Default command:
     `npm run agent-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."`
4. Interpret the selection.
   - Read the page URL/title, selected element metadata, and snapshot reference.
   - Prefer values you can verify from the repo, the current page, the saved selection, or `browser-*` commands before asking the user for them.
   - If the user references `pick 1`, `selection 2`, or similar, map the number to `elements[]` using 1-based indexing.
5. Work from that saved context.
   - Update the shared note as progress changes.
6. Before the final reply, leave a final note if code changed for the picked element.

## Browser bridge workflow

Use this when the user wants the Agent Picker Chrome extension to inspect a live tab.

1. Check the browser bridge session first.
   - Default command: `npm run agent-pickerd:get-browser-session`
   - Read `activeTabId`, `tabCount`, and `tabs[]` when multiple Chrome windows or tabs are open.
   - Prefer saying what you are checking right now over narrating a hypothetical blocker. For example: "I'll read the current browser session first."
2. If the session is missing or stale, fix the bridge before continuing.
   - Start the current daemon for this repo or host.
   - Reload the Chrome extension after extension code changes.
   - In the extension popup, point the daemon URL at the currently running daemon.
   - Browser control is WebSocket-based by default. Only use `AGENT_PICKER_TRANSPORT=legacy-poll` when you are intentionally debugging the deprecated transport.
   - If you are blocked, name the exact command you ran and the concrete failure. Do not replace that with a generic line about needing to "find where to launch the bridge command."
3. Prefer targeted tab commands when the user may switch away from the page.
   - Use `--tab-id`, `--url`, or `--url-contains` for background-tab DOM reads and clicks.
   - When `get-browser-session` reports more than one live tab, prefer `--tab-id` from that summary instead of relying on the current active tab.
4. Use the narrowest targeted browser command that answers the question.
   - `npm run agent-pickerd:browser-context -- --url-contains "example.com"`
   - `npm run agent-pickerd:browser-dom -- --url-contains "example.com"`
   - `npm run agent-pickerd:browser-click -- --url-contains "example.com" --role tab --exact-text --text "Next"`
   - `npm run agent-pickerd:browser-fill -- --url-contains "example.com" --label "Site URL" --value "https://example.com/privacy"`
   - `npm run agent-pickerd:browser-key -- --url-contains "example.com" --key Tab`
   - `npm run agent-pickerd:browser-click-point -- --url-contains "example.com" --x 420 --y 360`
   - `npm run agent-pickerd:browser-wait-for-text -- --url-contains "example.com" --text "Saved" --scope dialog`
   - `npm run agent-pickerd:browser-query-dom -- --url-contains "example.com" --kind input-by-label --text "Site URL" --scope dialog`
   - `npm run agent-pickerd:browser-screenshot -- --url-contains "example.com" --file ./tmp/current-tab.png`
5. Remember the current limitation.
   - DOM reads and clicks can target background tabs.
   - Screenshots will focus the requested target tab first, so prefer `--tab-id` or a precise URL target before capturing.

## Browser write safety

- Never infer success from a click alone.
- After any write action, verify the persisted state with a direct readback.
- Prefer selector, role, and label targeting over text-only clicks when duplicate text may exist.
- Use point clicks only after semantic targeting fails.

## Note statuses

- `acknowledged`: selection was read and triage started
- `in_progress`: active investigation or implementation is happening
- `fixed`: work is done and verified enough to hand back
- `needs_reselect`: saved selection is stale, too broad, or no longer matches the UI/code path

## Selection hygiene

- Treat `~/.codex/agent-picker/` or `$CODEX_HOME/agent-picker/` as shared state unless `AGENT_PICKER_STATE_HOME` overrides it.
- Do not clear notes unless they would mislead the next agent.
- Prefer `needs_reselect` over guessing when the saved element no longer matches the current UI.

## Response guardrails

- Do not invent setup problems before checking the repo and command output.
- In the standalone Agent Picker repo, assume the root `agent-pickerd:*` scripts are the starting point unless verification proves otherwise.
- When you need a bridge or daemon, state the exact next command you are about to run instead of a reusable fallback speech.
- If a command is unavailable, include the specific checked path or command in your explanation.

## Command and state details

Read [references/commands.md](references/commands.md) when you need:
- standalone vs installed-host command examples
- the shared Agent Picker state layout
- what fields to inspect inside the saved selection payload
- examples of when reselection is required
