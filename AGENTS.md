# Agent Workflow

## Working Context

- In the standalone Agent Picker repository, root scripts target `example/next-host`.
- In an installed host project, prefer host root scripts that wrap `agent-pickerd`.
- Treat the shared Agent Picker state home, usually `~/.codex/agent-picker/`, as shared coordination state, not private scratch space.

## Agent Picker First

- If the user mentions Agent Picker, the picker, a picked element, or says they selected something for you, read the latest selection first.
- If the user says `이거 봐줘` or `방금 선택한 거 봐줘`, interpret that as "read the latest Agent Picker selection first."
- If the user says `see pick1`, `check pick 1`, `look at selection 2`, or similar English shorthand, read the latest selection first and map the number to the `elements` array using 1-based indexing.
- Primary command in the standalone repo: `npm run agent-pickerd:get-selection`
- Primary command in an installed host: the host root `agent-pickerd:get-selection` script
- In this standalone repo, do not claim `agent-pickerd:*` scripts are missing unless you checked the root `package.json` or ran the command and saw it fail.
- Prefer concrete status updates like "I'll run `npm run agent-pickerd:get-browser-session` now" over generic bridge-triage preambles.

## Agent Notes

- When you begin work from a saved selection, acknowledge it in the shared note channel.
- Use `npm run agent-pickerd:set-agent-note -- --author codex --status acknowledged --message "Read the selection and investigating."`
- Update the note while working with `acknowledged`, `in_progress`, `fixed`, or `needs_reselect`.
- Use `needs_reselect` when the saved selection no longer matches the current UI or code path.

## Final Loop

- If you changed code for a picked element, leave a final agent note before replying.
- Include what changed, whether you verified it, and whether reselection is needed.
- Clear stale notes only when they would actively mislead the next agent.

## Repo Discipline

- Keep shared engine code inside `packages/`, `tools/agent-pickerd/`, `scripts/`, and `web/`.
- Keep example-only behavior inside `example/next-host/`.
- Do not hardcode product-specific names, storage keys, or routes into the shared engine without documenting them.
