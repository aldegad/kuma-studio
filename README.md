# Agent Picker

Agent Picker is a package-first UI selection bridge for coding agents. Mount the picker into your app, capture DOM selections, sync shared agent notes through `agent-pickerd`, and optionally render a separate design lab for comparing UI pieces.

## Packages

- `@agent-picker/picker`: app-shell provider and devtools overlay
- `@agent-picker/design-lab`: design-lab board UI and item types
- `@agent-picker/server`: `agent-pickerd` CLI and daemon entrypoint

## Develop This Repo

```bash
pnpm install
pnpm run dev
```

In another terminal:

```bash
pnpm run agent-pickerd:serve
```

Then open [http://127.0.0.1:3000/design-lab](http://127.0.0.1:3000/design-lab).

The example host stores local state in `example/next-host/.agent-picker/`.

## Install Into Your App

Agent Picker no longer needs a project installer. The current host shape is:

1. install the packages
2. add a provider near the app shell
3. expose the selection route
4. render a `design-lab` client route
5. run `agent-pickerd`

Detailed integration notes: [docs/install-next-app-router.md](./docs/install-next-app-router.md)

If your host uses Tailwind CSS v4, remember to add an `@source` entry for Agent Picker so the overlay classes are included in the generated CSS.

## Repo Layout

- `packages/picker/`: picker core provider and devtools overlay
- `packages/design-lab/`: design-lab board UI and registry helpers
- `packages/server/`: `agent-pickerd` package entrypoints
- `web/`: shared UI primitives, scene hooks, and devtools internals
- `tools/agent-pickerd/`: local state daemon implementation
- `scripts/`: standalone example runtime wiring
- `example/next-host/`: smoke-test host app for the standalone repository

## Agent Workflow

Agent Picker has a shared selection and note model so multiple coding agents can coordinate.

- latest selection: `pnpm run agent-pickerd:get-selection`
- latest note: `pnpm run agent-pickerd:get-agent-note`
- update note: `pnpm run agent-pickerd:set-agent-note -- --author codex --status in_progress --message "..."`

Agent-specific guidance lives here:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [GEMINI.md](./GEMINI.md)

## Common Commands

- `pnpm run dev`: start the bundled example host
- `pnpm run build`: build the bundled example host
- `pnpm run lint`: typecheck the example host
- `pnpm run test`: run daemon unit tests
- `pnpm run agent-pickerd:serve`: start the local daemon for the example host

## Docs

- [docs/install-next-app-router.md](./docs/install-next-app-router.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/agent-pickerd/README.md](./tools/agent-pickerd/README.md)

## License

[MIT](./LICENSE)
