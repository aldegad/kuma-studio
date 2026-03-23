# Kuma Shooting Range — Real-Time Reactivity Test Surface

## Purpose

The existing Kuma Picker test surfaces (Sudoku, Chat, Cafe) validate **accuracy** on static DOM elements: grid cells, chat messages, tab panels, and form inputs. None of them test what matters most for real-world agent interaction with dynamic visual content:

- **Sub-frame input latency** — can the agent track a moving target at 60 fps?
- **Canvas-only rendering** — there is no DOM to query; the agent must reason about pixel coordinates or read the metrics panel.
- **Time-critical decision-making** — dodging bullet patterns requires continuous input, not one-shot clicks.
- **High object throughput** — dozens of bullets and particles updating every frame stress the bridge's event pipeline.

The Shooting Range fills this gap with a 1945-style bullet-hell game rendered entirely on an HTML5 Canvas element.

## Architecture

```
src/
  app/shooting/page.tsx              ← Next.js route
  components/shooting/
    KumaShootingRange.tsx            ← Surface frame wrapper (hero + sidebar + canvas)
    ShootingGameCanvas.tsx           ← React component: input wiring, game loop, renderer
    shooting-engine.ts               ← Pure game logic (no DOM dependency)
```

### Separation of concerns

| Layer | File | Responsibility |
|-------|------|----------------|
| **Engine** | `shooting-engine.ts` | State machine, collision, enemy AI, bullet patterns. Zero DOM calls — fully testable in Node. |
| **Renderer** | `ShootingGameCanvas.tsx` | Canvas 2D draw calls, DPI scaling, pointer/keyboard event binding. |
| **Frame** | `KumaShootingRange.tsx` | `KumaSurfaceFrame` integration — hero description, sidebar story, pills. |
| **Route** | `page.tsx` | Next.js page export. |

## Game Mechanics

### Player
- Arrow/WASD keys or touch/pointer drag to move
- Auto-fire when pointer is held or Space/Z is pressed
- 3 lives, temporary invincibility after hit
- Spread level upgrades (1 → 3 bullets per shot)
- Shield power-up absorbs one hit

### Enemies (4 types)
| Kind | Shape | HP | Behavior |
|------|-------|----|----------|
| Grunt | Rectangle | 1+ | Drifts down with sine wobble, fires single shots |
| Spreader | Diamond | 3+ | Fires fan-shaped spread patterns |
| Bomber | Triangle | 2+ | Fast descent, fires aimed shots at player |
| Boss | Hexagon | 30+ | Appears every 5 waves, cycles spread → aimed → spiral patterns |

### Bullet patterns
- **Single**: straight down
- **Spread**: fan of N bullets covering an arc
- **Aimed**: bullet directed at player's current position
- **Spiral**: rotating ring of 12 bullets (boss only)

### Wave system
- Enemy spawn interval decreases each wave
- Enemy HP scales with wave number
- Boss spawns at wave 5, 10, 15, ...

## Real-Time Metrics Panel

The right-side panel exposes live telemetry updated every 15 frames (~250 ms at 60 fps):

| Metric | data-testid area | Purpose |
|--------|-----------------|---------|
| FPS | `shooting-metrics` | Rendering performance |
| Score | — | Game progress |
| Wave | — | Difficulty level |
| Lives | — | Player survival |
| Active Enemies | — | Scene complexity |
| Active Bullets | — | Collision workload |
| Particles | — | Visual effect count |
| Shots Fired | — | Player input frequency |
| Enemies Destroyed | — | Accuracy proxy |
| Total Inputs | — | Cumulative pointer events |
| Spread Level | — | Power-up state |
| Shield | — | Defensive state |

These metrics are DOM elements (not canvas-drawn), so agents can read them via standard selectors while the game runs.

## How to Test with Agent Picker

### 1. Visual coordinate-based interaction

The canvas element has `data-testid="shooting-canvas"`. An agent can:

```
1. Screenshot the canvas
2. Identify player ship position (blue arrow shape)
3. Identify enemy/bullet positions
4. Issue pointer events at computed coordinates to move the ship
```

The local bridge eliminates network latency — pointer events from the extension reach the canvas in under 1 ms on localhost.

### 2. Metrics-based assertions

After playing for N seconds, the agent can read the metrics panel:

```
- Assert FPS > 55 (rendering isn't dropping frames)
- Assert Enemies Destroyed > 0 (player bullets hit targets)
- Assert Lives > 0 (player survived)
- Assert Total Inputs > 100 (continuous interaction happened)
```

### 3. Screenshot-diff temporal testing

Capture screenshots at T=0, T=1s, T=2s. Verify:
- Frame content changed (game is animating)
- Player position shifted (input was applied)
- Score increased (gameplay progressed)

### 4. Touch/pointer sequence testing

Use `browser-sequence` to script a series of pointer events:

```json
[
  { "action": "pointerdown", "x": 210, "y": 560 },
  { "action": "pointermove", "x": 100, "y": 500 },
  { "action": "pointermove", "x": 300, "y": 450 },
  { "action": "pointerup" }
]
```

Verify the player ship followed the path by checking coordinate changes.

## Methodology & Research Context

### Why canvas games for agent testing?

Current GUI agent benchmarks (WebArena, OSWorld, BrowserGym) focus on **discrete interactions**: click a button, fill a form, navigate a page. They don't measure:

1. **Continuous input streams** — holding a pointer and dragging across frames
2. **Time-varying visual state** — scenes that change whether or not the agent acts
3. **Reaction time** — how fast the agent responds to new threats

Game environments address all three. Prior work:
- **VOYAGER** (2023) — LLM agent in Minecraft via self-generated curricula
- **Cradle** (2024) — Multimodal LLM playing Red Dead Redemption 2 via screenshots
- **LLM-based game QA** (arXiv 2509.22170, 2025) — automated video game testing with LLM agents

### Local bridge advantage

Unlike cloud-based game agents that suffer 100–500 ms screenshot round-trip latency, Kuma Picker's bridge runs on localhost:
- **Extension → daemon**: WebSocket on `127.0.0.1:4312` (~0.1 ms)
- **Screenshot capture**: Chrome debugger protocol, local (~10–30 ms for 420×700 viewport)
- **Pointer injection**: Direct `dispatchEvent` via content script (~0.1 ms)

This sub-50 ms total loop makes 60 fps interaction theoretically possible with a fast model.

### Practical approach for fast models

Models like Codex Spark or Haiku that respond in <500 ms can:
1. Capture a screenshot every 500 ms (2 fps observation)
2. Compute a "safe zone" from bullet positions
3. Issue a single pointer-move to the safe zone
4. Repeat

Even at 2 fps observation, the continuous pointer-hold mechanic means the ship keeps moving between observations. The agent doesn't need to react every frame — it needs to set a trajectory that remains safe for ~30 frames.

### Memory/context optimization for extended play

For long play sessions, agents should:
- **Discard old screenshots** — only keep the most recent 1–2 frames
- **Summarize state numerically** — read the metrics panel instead of analyzing pixels
- **Use coordinate math** — predict bullet trajectories from positions + velocities rather than re-analyzing each frame

## File Inventory

| File | Lines | Description |
|------|-------|-------------|
| `shooting-engine.ts` | ~400 | Pure game state machine |
| `ShootingGameCanvas.tsx` | ~280 | Canvas renderer + React input bindings |
| `KumaShootingRange.tsx` | ~50 | Surface frame layout |
| `page.tsx` | ~5 | Next.js route |
| `kuma-assets.ts` | +1 line | Icon constant |
| `KumaTestLab.tsx` | +10 lines | Launcher registration |
| `globals.css` | +5 lines | Icon shadow style |
| `kuma-assets.ts` + generated art asset | — | Shared launcher and surface icon wiring |
