# Browser Control Checklist

This checklist tracks the cleaned-up browser automation surface after the move to `kuma-pickerd run`.

## Goal

Make Kuma Picker feel natural to agents that already think in Playwright terms, while keeping Kuma's extension bridge, shared state, and gesture overlays.

## Public surface

- [x] `kuma-pickerd run [file]`
- [x] stdin script execution
- [x] explicit target requirement: `--tab-id`, `--url`, or `--url-contains`
- [x] no public `browser-*` automation commands
- [x] no fallback or compatibility layer for removed commands

## Supported API

- [x] `page.goto`
- [x] `page.reload`
- [x] `page.url`
- [x] `page.title`
- [x] `page.screenshot`
- [x] `page.evaluate`
- [x] `page.locator`
- [x] `page.getByText`
- [x] `page.getByRole`
- [x] `page.getByLabel`
- [x] `page.waitForSelector`
- [x] `page.keyboard.press|down|up`
- [x] `page.mouse.click|move|down|up|drag`
- [x] `locator.click|fill|press|textContent|inputValue|isVisible|waitFor|screenshot|first|last|nth`
- [x] `locator.boundingBox`

## Runtime expectations

- [x] unsupported APIs hard-fail with Playwright-shaped error messages
- [x] extension runtime stays WebSocket-only
- [x] click animation remains
- [x] scroll animation remains
- [x] hold animation remains
- [x] drag animation remains

## Benchmark surfaces

- [x] `/`
- [x] `/agent-chat`
- [x] `/contenteditable-lab`
- [x] `/sudoku`
- [x] `/cafe-control-room`
- [x] `/shooting`

## Benchmark scenarios

- [x] `/agent-chat`: fill composer, send, verify transcript, reset
- [x] `/contenteditable-lab`: multiline write, Enter, verify readback
- [x] `/sudoku`: select cell, type digit, verify value
- [x] `/cafe-control-room`: switch tab, save dialog, wait for toast
- [x] `/shooting`: hold key input, drag pointer input, verify metrics

## Scorecard template

| Date | Surface | Scenario | Script style | Expected result | Actual result | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | `/agent-chat` | write + verify | `run` + `page` | transcript contains new line | pending | yes/no |
