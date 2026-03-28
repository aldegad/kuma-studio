# Playwright Parity Benchmark Rules

This document defines the minimum rules for a fair comparison between Kuma Picker's `run` surface and real Playwright. The repository ships reusable shared scenarios, a Kuma attach runner, a Playwright attach runner, and a comparison command that rejects mismatched runs.

## Comparison rules

- Compare the same scenario boundary on both sides.
- Start each run from the same app state.
- Use the same selectors, target data, and verification conditions.
- Use the same timeout budget and retry policy.
- Use the same browser channel, machine class, and run count.
- Use the same connection mode on both sides.
- Either both tools attach to an existing tab, or both tools launch a fresh browser.
- Record the repo commit, browser user agent, and target metadata in both outputs.
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

## Commands

Kuma-only repeated measurements:

```bash
npm run kuma-pickerd:measure -- --tab-id 123 --repeat 3
npm run kuma-pickerd:measure -- --scenario shooting --tab-id 123 --repeat 5
```

Fair parity runs against the same attached browser target:

```bash
npm run kuma-pickerd:parity:kuma -- --url-contains "localhost:3000" --browser-version "146.0.7680.165" --repeat 3 --output ./artifacts/parity/kuma.json
npm run kuma-pickerd:parity:playwright -- --cdp-url "http://127.0.0.1:9222" --url-contains "localhost:3000" --browser-version "146.0.7680.165" --playwright-module-path /tmp/kuma-picker-parity-playwright/node_modules/playwright/index.mjs --repeat 3 --output ./artifacts/parity/playwright.json
npm run kuma-pickerd:parity:compare -- --kuma ./artifacts/parity/kuma.json --playwright ./artifacts/parity/playwright.json
```

The compare step is part of the benchmark. If it fails, the run set does not count as parity evidence.
