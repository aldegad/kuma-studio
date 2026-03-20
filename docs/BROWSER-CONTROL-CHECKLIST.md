# Browser Control Checklist

This is the working checklist for Kuma Picker browser-control basics.
Phase 1 is intentionally about low-level control quality, not app-specific helpers.

## Phase 1 goal

Make Kuma Picker feel reliable enough for sustained browser interaction before adding app adapters such as Google Sheets helpers.

Success means:

- real write actions are stable after refresh/reconnect
- low-level input primitives cover the common cases that currently feel easier in Playwright
- every primitive is benchmarked against bundled test apps, not just unit tests
- app-specific helpers stay out of the default surface until the basics are proven

## Why this exists

Current reality:

- Kuma Picker is already strong at shared state, live browser session reads, screenshots, DOM snapshots, and work-card coordination.
- Playwright still feels more natural for direct browser driving because it exposes low-level input primitives like `keydown`, `keyup`, `mousemove`, `mousedown`, and `mouseup` directly.
- We should close that gap first, then layer app adapters on top.

## Non-goals for Phase 1

- Do not build Google Sheets helpers first.
- Do not grow the default skill prompt with app-specific instructions.
- Do not add helpers that hide weak primitives instead of fixing them.

## Phase 1 checklist

### A. Core input primitives

- [x] `browser-key --hold-ms` supports sustained key input.
- [x] `browser-pointer-drag` works for repeated real-time interaction.
- [ ] Add `browser-keydown`.
- [ ] Add `browser-keyup`.
- [ ] Add `browser-mousemove`.
- [ ] Add `browser-mousedown`.
- [ ] Add `browser-mouseup`.
- [ ] Add key chord support for common combos like copy/paste/select-all.

### B. Bridge reliability

- [x] Reattach browser command tools after refresh when content scripts are briefly unavailable.
- [x] Preserve advanced command payloads through the daemon bridge.
- [ ] Add consistent write-path auto-focus before interaction commands.
- [ ] Add an optional "restore previous active tab" flow after focused write actions.
- [ ] Add clearer transient-error reporting for refresh/reconnect races.
- [ ] Benchmark repeated refresh -> write -> verify loops on the same tab.

### C. Verification and readback

- [x] `browser-dom`, `browser-console`, and `browser-screenshot` are usable for post-action checks.
- [ ] Add a lighter-weight assert/readback helper for write-after-read verification.
- [ ] Make `browser-sequence` less verbose for write + assert loops.
- [ ] Prefer deterministic test ids or visible metric hooks in test apps where verification is noisy.

### D. Ergonomics

- [x] Document the installed extension root for Codex skill installs.
- [ ] Add examples for sustained key/mouse interaction to the command docs.
- [ ] Add "when to use Kuma vs Playwright" guidance to maintainer docs.
- [ ] Define a small benchmark scorecard template so regressions are easy to spot.

## Benchmark surfaces

These bundled surfaces should be the default benchmark set for Phase 1.

| Surface | Route | What it validates | Target status |
| --- | --- | --- | --- |
| Lab home | `/` | semantic click, navigation, screenshot, background-tab reads | In rotation |
| Agent chat | `/agent-chat` | textarea write, send, transcript readback, reset flow | In rotation |
| Sudoku | `/sudoku` | dense cell targeting, keyboard input, readback verification | In rotation |
| Cafe control room | `/cafe-control-room` | tabs, menu state, dialog flow, toast waits, file download | In rotation |
| Shooting range | `/shooting` | hold input, drag input, refresh/reconnect stability, real-time metrics | In rotation |

## Benchmark checklist by surface

### Lab home

- [ ] Click a surface card by semantic target.
- [ ] Navigate into a surface and verify URL/title.
- [ ] Capture a screenshot after navigation.

### Agent chat

- [ ] Fill `1P` composer.
- [ ] Send a message.
- [ ] Read the new bubble back from the transcript.
- [ ] Reset the room and verify the cleared state.

### Sudoku

- [ ] Select an editable cell.
- [ ] Enter a number by keyboard.
- [ ] Verify the value changed.
- [ ] Repeat across multiple cells without stale-target drift.

### Cafe control room

- [ ] Switch tabs.
- [ ] Open and close the station menu.
- [ ] Open the seasonal dialog.
- [ ] Save the dialog and wait for toast confirmation.
- [ ] Trigger the CSV export and verify the download.

### Shooting range

- [x] Start the game after `Tap to Start`.
- [x] Fire with sustained key input.
- [x] Move with pointer drag.
- [x] Survive repeated control cycles after refresh.
- [x] Observe live metric increases through DOM/screenshot checks.

## Exit criteria for Phase 1

Phase 1 is considered done when:

- all five benchmark surfaces pass their baseline scenarios
- Kuma Picker can cover the common low-level input cases without leaning on app adapters
- the remaining delta versus Playwright is small enough that app-specific helpers feel additive, not compensatory

## Phase 2 candidates

Only after Phase 1 is stable:

- spreadsheet/grid adapter
- sheet status helper
- sheet tab selection
- sheet range selection
- sheet block paste + readback diff
- infinite-canvas helper surfaces if current apps are still too DOM-heavy
