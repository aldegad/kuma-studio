# Playwright Parity Benchmark Rules

This document defines the minimum rules for a fair comparison between Kuma Picker's `run` surface and real Playwright. The repository ships reusable scenarios and a Kuma-side measurement runner, but it does not treat Kuma-only numbers as parity results.

## Comparison rules

- Compare the same scenario boundary on both sides.
- Start each run from the same app state.
- Use the same selectors, target data, and verification conditions.
- Use the same timeout budget and retry policy.
- Use the same browser channel, machine class, and run count.
- Use the same connection mode on both sides.
- Either both tools attach to an existing tab, or both tools launch a fresh browser.
- Removed `browser-*` commands are out of scope.

## Core scenarios

- `/agent-chat`: fill, send, transcript readback, reset
- `/contenteditable-lab`: multiline write, Enter, readback
- `/sudoku`: dense cell target, digit input, value verify
- `/cafe-control-room`: tab switch, dialog save, toast wait
- `/shooting`: sustained key input, drag input, metric verify

## What does not count as parity evidence

- Kuma-only repeated timings
- tool-specific UX advantages such as gesture overlays
- control-plane architecture differences by themselves
- installation convenience or dependency count
- unsupported APIs on one side that were silently replaced with a different task

## Scorecard template

| Date | Tool | Surface | Scenario | Runs | Success Rate | Median ms | P95 ms | Manual Intervention | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Kuma | `/agent-chat` | fill + verify | 10 | 0% | 0 | 0 | 0 | pending |
| YYYY-MM-DD | Playwright | `/agent-chat` | fill + verify | 10 | 0% | 0 | 0 | 0 | pending |

## Local measurement runner

The repo includes a Kuma-side measurement runner for repeated local timings:

```bash
npm run kuma-pickerd:measure -- --tab-id 123 --repeat 3
npm run kuma-pickerd:measure -- --scenario shooting --tab-id 123 --repeat 5
```

It writes JSON reports under `artifacts/measurements/` by default.

Those reports are useful input for a parity study, but they are not parity results until a matching Playwright run is produced under the same rules above.
