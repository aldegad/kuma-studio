---
name: kuma-picker
description: Read the latest Kuma Picker selection, screenshot, job state, and browser bridge status before working on picked UI or browser-driven investigation. Use when the user mentions Kuma Picker, a picked element, a saved selection, browser extension control, tab inspection, DOM reads, clicks, screenshots, or shorthand like "check pick 1", and when work should start from the shared Kuma Picker state home.
---

# Kuma Picker

Kuma Picker repo is installed at:

```
__KUMA_PICKER_REPO__
```

All CLI commands use this path directly:

```bash
node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs <command> [args]
```

The Chrome extension is loaded from:

```
__KUMA_PICKER_REPO__/packages/browser-extension/
```

## Installation

When the user asks to install Kuma Picker, run:

```bash
node __KUMA_PICKER_REPO__/scripts/install.mjs
```

This handles: dependency install, daemon start, shared state home creation, and installing the current agent skill by default.
Add `--all` if you explicitly want both the Codex and Claude skill folders stamped in one run.
The only human step is loading the Chrome extension (see below).

### Health check

```bash
node __KUMA_PICKER_REPO__/scripts/doctor.mjs
```

### The one human step

The Chrome extension cannot be installed by an agent. Tell the user:

> Please load the Chrome extension manually:
> 1. Open `chrome://extensions`
> 2. Turn on "Developer mode" in the top-right corner
> 3. Click "Load unpacked"
> 4. Select `__KUMA_PICKER_REPO__/packages/browser-extension/`
> 5. Refresh any page once

Then verify:
```bash
node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs get-browser-session
```

## State home

Kuma Picker resolves its shared state directory in this priority order:

1. `KUMA_PICKER_STATE_HOME` — explicit override (highest priority)
2. `~/.kuma-picker/` — shared default for Claude and Codex

## Core workflow

1. Read the latest selection before doing anything else.
   ```bash
   node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs get-selection
   ```
   - Use `--recent 5` for bounded recent history.
   - Use `--all` only when the user explicitly needs the full collection.
2. If the latest selection includes a `job`, treat it as the user's explicit task.
   - When you begin work:
     ```bash
     node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs set-job-status --status in_progress --message "Implementing the requested change."
     ```
3. Interpret the selection.
   - Read `page.url`, `page.title`, element metadata, and snapshot reference.
   - If the user references `pick 1`, `selection 2`, map to `elements[index - 1]`.
4. Work from that saved context.
5. Before the final reply, mark completed:
   ```bash
   node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs set-job-status --status completed --message "Updated the picked element and verified the change."
   ```

## Browser bridge workflow

1. Check the browser bridge session:
   ```bash
   node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs get-browser-session
   ```
2. If missing or stale, start the daemon:
   ```bash
   node __KUMA_PICKER_REPO__/packages/server/src/cli.mjs serve
   ```
3. Prefer targeted tab commands (`--tab-id`, `--url`, `--url-contains`).
4. Use the narrowest command that answers the question. See [references/commands.md](references/commands.md).
5. When the task matches a bundled smoke surface, prefer the reusable scripts under `scripts/run/` before inventing a one-off flow.
6. `Playwright` is not required for normal Kuma Picker use. It is only needed when the user explicitly wants a Kuma vs Playwright parity comparison.

## Browser write safety

- Never infer success from a click alone.
- After any write action, verify with a direct readback.
- Prefer `run` scripts that keep the write and the readback in the same `page` flow.
- Prefer selector, role, and label targeting over text-only clicks.

## Reusable runners

- Use `npm run kuma-pickerd:smoke -- --scenario <id>` for bundled smoke flows.
- Use `npm run kuma-pickerd:measure -- ...` only for Kuma-side repeated timings.
- Use the parity runners only when the user explicitly wants a fair Kuma vs Playwright comparison.
- Parity comparisons require running both `kuma-pickerd:parity:kuma` and `kuma-pickerd:parity:playwright`, then validating them with `kuma-pickerd:parity:compare`.

## Job cards

- `Pick With Job` creates a selection with `job` metadata and a visible note card on the page.
- Use `set-job-status --status in_progress` when starting work.
- Use `set-job-status --status completed` with a summary when done.

### Blocked-on-user-input workflow

When the agent is blocked on a manual step the user must perform in the browser, prefer leaving a visible job card exactly at that spot instead of burying the request in chat.

Good examples:

- a password or 2FA code the agent cannot know
- a CAPTCHA or hardware-security-key prompt
- a judgment call that is easier for the user to make in the page
- a final confirmation that should stay visibly attached to the UI

Recommended flow:

1. Pick the exact element or area with `Pick With Job`.
2. Write a short action-oriented message in the job card.
   - Good: `Enter the password here, click Sign in, then let me know.`
   - Good: `Please confirm whether this toggle should be enabled, then call me back.`
3. Treat the saved `job.message` as the source of truth when resuming.
4. When the user finishes the manual step, read the latest selection or page state again before continuing.

If the user explicitly asks the agent to leave something for them to do later, prefer a job card over a long textual reminder.

## Selection hygiene

- Treat the state home as shared state.
- Prefer asking for a reselection over guessing when the saved element no longer matches.

## Response guardrails

- Do not invent setup problems before checking command output.
- State the exact command you are about to run.
- If a command is unavailable, include the specific error.

## Command and state details

Read [references/commands.md](references/commands.md) for command examples, state layout, and field details.
