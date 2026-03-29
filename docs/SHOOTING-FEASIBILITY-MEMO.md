# Canvas Game Interaction — Kuma Picker Capability Memo

## Background

- We want Kuma Picker to play **canvas-based games** such as shooters, Three.js demos, and Phaser scenes.
- DOM-focused scenarios are already covered by surfaces like Sudoku. The goal here is to handle a world that is **not driven by the DOM**.
- In a canvas game, the main observation tool is **screenshots** because there is no meaningful DOM tree to read.

## Existing limitations

### 1. `dispatchClickSequence` used to be immediate

```js
// agent-actions-interaction.js:94-100
function dispatchClickSequence(target, clientX, clientY) {
  dispatchMouseEvent(target, "pointerdown", clientX, clientY);
  dispatchMouseEvent(target, "mousedown", clientX, clientY);
  dispatchMouseEvent(target, "pointerup", clientX, clientY); // immediate
  dispatchMouseEvent(target, "mouseup", clientX, clientY);
  dispatchMouseEvent(target, "click", clientX, clientY);
}
```

There was effectively `0ms` between `pointerdown` and `pointerup`. From the game's perspective, that meant a zero-frame tap.

### 2. There was no `pointermove`

The old command surface handled clicks, fills, keys, DOM reads, context reads, console output, measurements, waits, and sequences.
It did **not** have a continuous gesture primitive.

### 3. The default `400ms` delay

That delay was reasonable for DOM apps where a click might need to wait for a React rerender.
For canvas games it added cost without improving reliability. The core issue was not structural because `postActionDelayMs: 0` was already possible.

## Solution: path input via `page.mouse.drag`

### Basic form (`from` -> `to`)

```bash
cat <<'EOF' | node ./packages/server/src/cli.mjs run --url-contains "localhost:3000"
await page.mouse.drag({ x: 200, y: 500 }, { x: 300, y: 400 }, { durationMs: 500 });
EOF
```

### Waypoint support

```bash
// v1 does not support waypoints directly, so compose them from multiple drag/move calls.
```

### How it works

```text
pointerdown(from) -> mousedown(from)
  -> [pointermove + mousemove] × N steps (durationMs / 16 ~= 60fps)
pointerup(to) -> mouseup(to)
```

- `steps` controls event density and defaults to roughly `durationMs / 16`
- `postActionDelayMs` can stay at `0` for canvas-heavy flows
- Waypoint interpolation can be distance-aware, so the path does not have to be a simple straight line
- The primitive can still be composed inside larger flows

### Where this helps beyond games

- Sliders
- Map panning
- Drag and drop
- Swipes
- Drawing surfaces
- Long press by using `from === to` with a non-zero `durationMs`
- Games such as shooters, puzzle boards, and simulations

## Responsiveness strategies

### A. Clip screenshots for faster visual feedback

Capture only the region of interest instead of the full screen:

```bash
cat <<'EOF' | node ./packages/server/src/cli.mjs run --url-contains "localhost:3000"
await page.screenshot({ path: "/tmp/region.png", clip: { x: 100, y: 300, width: 200, height: 200 } });
EOF
```

Smaller images are faster to capture and cheaper for the model to reason about.

### B. Use waypoints to make one decision last longer

Let the model plan two to three seconds of motion in one reasoning pass:

```json
{
  "type": "pointer-drag",
  "waypoints": [
    { "x": 200, "y": 500 },
    { "x": 150, "y": 450 },
    { "x": 300, "y": 400 },
    { "x": 250, "y": 500 }
  ],
  "durationMs": 2000
}
```

That allows an ~800ms reasoning delay to be amortized across a longer execution window.

### C. Alternate drag and screenshot steps inside one sequence

```json
{
  "type": "sequence",
  "steps": [
    { "type": "pointer-drag", "fromX": 200, "fromY": 500, "toX": 150, "toY": 450, "durationMs": 500 },
    { "type": "screenshot", "clipRect": { "x": 100, "y": 300, "width": 200, "height": 200 } },
    { "type": "pointer-drag", "fromX": 150, "fromY": 450, "toX": 300, "toY": 400, "durationMs": 500 },
    { "type": "screenshot", "clipRect": { "x": 100, "y": 300, "width": 200, "height": 200 } }
  ]
}
```

This creates one round trip that alternates between moving and observing, so each screenshot informs the next plan.

### D. A realistic agent loop

```text
1. Capture a clipped screenshot (~20ms)
2. Let the model locate the threat and plan ~2 seconds of avoidance (~800ms)
3. Execute a 2-second pointer-drag path
4. Repeat
```

That yields a rough 3-second loop where about 2 seconds are real motion. Games can be tuned around that cadence.

## Open questions

- Multi-pointer gestures like pinch zoom are still out of scope, but the structure should leave room for them
- What happens if an observation command needs to run while a drag is still in flight? The current WebSocket path is still serialized
- Game difficulty tuning is game-specific, so this should stay a benchmark testbed rather than pretending to be a universal policy
