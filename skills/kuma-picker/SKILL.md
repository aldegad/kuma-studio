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

This handles: dependency install, daemon start, state home creation, and global skill setup.
The only human step is loading the Chrome extension (see below).

### Health check

```bash
node __KUMA_PICKER_REPO__/scripts/doctor.mjs
```

### The one human step

The Chrome extension cannot be installed by an agent. Tell the user:

> Chrome 익스텐션 하나만 직접 로드해주세요:
> 1. chrome://extensions 열기
> 2. 우측 상단 "개발자 모드" 켜기
> 3. "압축해제된 확장 프로그램을 로드합니다" 클릭
> 4. `__KUMA_PICKER_REPO__/packages/browser-extension/` 폴더 선택
> 5. 아무 페이지에서 새로고침 한 번

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

## Browser write safety

- Never infer success from a click alone.
- After any write action, verify with a direct readback.
- Prefer `browser-sequence` with per-step `assert` checks.
- Prefer selector, role, and label targeting over text-only clicks.

## Job cards

- `Pick With Job` creates a selection with `job` metadata and a `메모 남김` card on the page.
- Use `set-job-status --status in_progress` when starting work.
- Use `set-job-status --status completed` with a summary when done.

## Selection hygiene

- Treat the state home as shared state.
- Prefer asking for a reselection over guessing when the saved element no longer matches.

## Response guardrails

- Do not invent setup problems before checking command output.
- State the exact command you are about to run.
- If a command is unavailable, include the specific error.

## Command and state details

Read [references/commands.md](references/commands.md) for command examples, state layout, and field details.
