# Agent Workflow

## Working Context

- Treat the shared Kuma Picker state home as shared coordination state, not private scratch space.

## Kuma Picker First

- If the user mentions Kuma Picker, the picker, a picked element, or says they selected something for you, read the latest selection first.
- If the user says "check this" or "look at what I just picked," interpret that as "read the latest Kuma Picker selection first."
- If the user says `see pick1`, `check pick 1`, `look at selection 2`, or similar English shorthand, read the latest selection first and map the number to the `elements` array using 1-based indexing.
- Primary command: `npm run kuma-pickerd:get-selection`
- Do not claim `kuma-pickerd:*` scripts are missing unless you checked the root `package.json` or ran the command and saw it fail.
- Prefer concrete status updates like "I'll run `npm run kuma-pickerd:get-browser-session` now" over generic bridge-triage preambles.

## Job Cards

- When you begin work from a saved selection, update the shared work card instead of writing a separate note.
- Use `npm run kuma-pickerd:set-job-status -- --status in_progress --message "Read the selection and investigating."`
- Use `completed` when the visible work is done and verified.
- If the saved selection no longer matches the current UI or code path, ask for a reselection instead of inventing a separate note state.

## Final Loop

- If you changed code for a picked element, leave a final job-card update before replying.
- Include what changed, whether you verified it, and whether reselection is needed.

## UI QA

- For frontend or visual changes, do not stop at code review alone.
- Capture a fresh Kuma Picker screenshot of the actual page and inspect alignment, spacing, scroll behavior, and overall design quality before replying.
- Call out the specific screenshot you checked and summarize what passed or still looks wrong.

## Repo Discipline

- Keep shared engine code inside `packages/`, `tools/kuma-pickerd/`.
- Do not hardcode product-specific names, storage keys, or routes into the shared engine without documenting them.
