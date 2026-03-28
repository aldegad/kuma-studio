# Playwright Parity Benchmark

This document compares Kuma Picker's `run`-based automation surface with real Playwright-style scripting.

## Comparison rules

- Kuma uses `kuma-pickerd run` only.
- Kuma scripts must do both the write and the verification in the same script when possible.
- Playwright comparison runs should use the same scenario boundaries.
- Removed `browser-*` commands are out of scope.

## Core scenarios

- `/agent-chat`: fill, send, transcript readback, reset
- `/contenteditable-lab`: multiline write, Enter, readback
- `/sudoku`: dense cell target, digit input, value verify
- `/cafe-control-room`: tab switch, dialog save, toast wait
- `/shooting`: sustained key input, drag input, metric verify

## Kuma script example

```js
await page.goto("http://localhost:3000/agent-chat");
await page.getByLabel("1P Composer").fill("hello from kuma");
await page.getByRole("button", { name: "Send from 1P" }).click();
await page.getByText("hello from kuma").waitFor();
```

## Scorecard template

| Date | Tool | Surface | Scenario | Runs | Success Rate | Median ms | P95 ms | Manual Intervention | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Kuma | `/agent-chat` | fill + verify | 10 | 0% | 0 | 0 | 0 | pending |
| YYYY-MM-DD | Playwright | `/agent-chat` | fill + verify | 10 | 0% | 0 | 0 | 0 | pending |

## Local runner

For Kuma-side repeated measurements:

```bash
npm run kuma-pickerd:benchmark -- --tab-id 123 --repeat 3
npm run kuma-pickerd:benchmark -- --scenario shooting --tab-id 123 --repeat 5
```

The runner writes JSON reports under `artifacts/benchmarks/` by default.

## Interpretation

- Success rate comes first.
- If success rate is similar, prefer the tool that closes the workflow in one script with less control-plane chatter.
- Kuma-specific observations should also note whether gesture overlays remained visible during click, scroll, hold, and drag interactions.
