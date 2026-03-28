# Playwright Parity Benchmark Rules

This document defines the minimum rules for a fair comparison between Kuma Picker's `run` surface and real Playwright. The repository ships reusable shared scenarios, a Kuma attach runner, a Playwright attach runner, and a comparison command that rejects mismatched runs.

Playwright is not required to use Kuma Picker. It is only required when you want to execute the Playwright side of this parity benchmark.

## Current verified snapshot

Latest verified parity run from **2026-03-28** shows:

| Scenario | Kuma | Playwright | Outcome |
| --- | ---: | ---: | --- |
| `agent-chat` | `458ms` | `483ms` | Kuma faster |
| `contenteditable-lab` | `444ms` | `426ms` | Playwright faster |
| `sudoku` | `431ms` | `478ms` | Kuma faster |
| `cafe-control-room` | `598ms` | `550ms` | Playwright faster |
| `shooting` | `1387ms` | `1057ms` | Playwright faster |

Interpretation:

- this is a fair result, not a marketing result
- both tools completed the verified run set at `100%` success
- the compare step passed on the same browser label: `Google Chrome 146.0.7680.165`
- Kuma is now in the same rough latency band for these attach-mode scenarios
- Playwright still wins some scenarios, especially the heavier `shooting` flow
- this is still a `repeat 1` snapshot, so the right claim is "much closer," not "case closed"

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
- "Kuma is cuter" as a substitute for speed data

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

## Product note

Kuma Picker still intentionally keeps the visible paw-feedback layer. That product choice is real, and it carries cost. The benchmark should measure that cost instead of hiding it.

The right way to present Kuma is:

- be honest when Playwright is faster
- keep reducing avoidable overhead
- argue for Kuma on shared-session workflow, visible feedback, and agent coordination only after the timing data is already on the table
