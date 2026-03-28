# Contributing

Thanks for taking a look at Kuma Picker.

Kuma Picker is still moving quickly, but outside contributions are welcome when they keep the project simpler, more reliable, and more honest.

## Good first contribution shapes

- bug fixes with a clear reproduction
- docs improvements that reduce setup confusion
- tests for parity, smoke, and bridge behavior
- performance work that preserves visible paw-feedback and shared-session workflows
- cleanup that removes dead code, fallback code, or duplicated logic

## Before you send a change

1. read [README.md](./README.md)
2. read [AGENTS.md](./AGENTS.md) if your change touches shared browser or agent workflow
3. keep the public browser automation surface on `run` + the Playwright-shaped API
4. avoid reintroducing removed `browser-*` compatibility layers

## Development checklist

```bash
npm install
npm test
npm run kuma-pickerd:smoke -- --scenario agent-chat
```

If your change touches parity logic or benchmark claims, also rerun:

```bash
npm run kuma-pickerd:parity:kuma -- --url-contains "localhost:3000" --browser-version "146.0.7680.165" --repeat 1
npm run kuma-pickerd:parity:playwright -- --cdp-url "http://127.0.0.1:9222" --url-contains "localhost:3000" --browser-version "146.0.7680.165" --playwright-module-path /tmp/kuma-picker-parity-playwright/node_modules/playwright/index.mjs --repeat 1
npm run kuma-pickerd:parity:compare -- --kuma ./artifacts/parity/kuma.json --playwright ./artifacts/parity/playwright.json
```

Do not claim parity wins from Kuma-only measurements.

## Project expectations

- keep shared engine code inside `packages/` and `tools/kuma-pickerd/`
- prefer deleting dead paths over stacking fallback layers
- preserve the visible interaction layer unless the change is explicitly about that layer
- keep benchmark language honest, even when Kuma is slower
- do not hardcode product-specific routes or storage keys into shared engine code without documenting why

## Pull requests

Small, focused pull requests are much easier to review than broad refactors.

Please include:

- what changed
- how you verified it
- whether the change affects smoke or parity behavior
- screenshots or short notes if you changed visible browser feedback
