---
name: agent-picker
description: Read the latest Agent Picker selection, screenshot, and shared note state before working on picked UI. Use when a repo exposes `agent-pickerd:*` scripts, when the user mentions Agent Picker, a picked element, a saved selection, or shorthand like "check pick 1", and when work should start from `.agent-picker/` shared coordination state.
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
