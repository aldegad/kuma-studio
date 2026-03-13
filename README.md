# Agent Picker

Agent Picker is a repo-first UI selection bridge for coding agents. Clone or subtree this repository into your app, wire a small set of `tsconfig` aliases, and mount the provider to capture DOM selections, sync shared agent notes through `agent-pickerd`, and optionally render a design lab for comparing UI pieces.

## Domains

- `packages/picker/`: app-shell provider and devtools overlay
- `packages/design-lab/`: design-lab board UI and item types
- `packages/server/`: `agent-pickerd` entrypoint shim
- `web/`: shared UI primitives, scene hooks, and devtools internals
- `tools/agent-pickerd/`: local state daemon implementation

## Develop This Repo

```bash
npm install
npm run dev
```

`npm run dev` starts both the example web host and `agent-pickerd`, and automatically keeps the web app pointed at the daemon even when the default ports are occupied.

Then open the printed `design-lab` URL in the terminal. If `3000` is free, it will usually be [http://127.0.0.1:3000/design-lab](http://127.0.0.1:3000/design-lab).

The example host stores local state in `example/next-host/.agent-picker/`.

## Install Into Your App

Agent Picker is currently designed to be vendored into a host repo.

1. add this repo under a stable path such as `apps/web/vendor/agent-picker`
2. add `tsconfig` aliases that map `@agent-picker/picker` and `@agent-picker/design-lab` to that vendored source
3. add a provider near the app shell
4. expose the selection route
5. render a `design-lab` client route if you want the board
6. run `agent-pickerd` from the vendored CLI path

Detailed integration notes: [docs/install-next-app-router.md](./docs/install-next-app-router.md)

If your host uses Tailwind CSS v4, remember to add an `@source` entry for the vendored Agent Picker source so overlay classes are included in the generated CSS.

## Repo Layout

- `packages/picker/`: picker-facing exports for host apps
- `packages/design-lab/`: design-lab-facing exports for host apps
- `packages/server/`: CLI shim kept close to the repo root
- `web/`: internal implementation shared by those domains
- `tools/agent-pickerd/`: daemon implementation and local-state rules
- `scripts/`: standalone example runtime wiring
- `example/next-host/`: smoke-test host app using the same alias model as consumers

## Agent Workflow

Agent Picker has a shared selection and note model so multiple coding agents can coordinate.

- latest selection: `npm run agent-pickerd:get-selection`
- latest note: `npm run agent-pickerd:get-agent-note`
- update note: `npm run agent-pickerd:set-agent-note -- --author codex --status in_progress --message "..."`

Agent-specific guidance lives here:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [GEMINI.md](./GEMINI.md)

## Common Commands

- `npm run dev`: start the bundled example host and daemon together
- `npm run dev:web`: start only the example host
- `npm run dev:daemon`: start only the daemon
- `npm run build`: build the bundled example host
- `npm run lint`: typecheck the example host
- `npm run test`: run daemon unit tests
- `npm run agent-pickerd:serve`: start the local daemon for the example host

## Docs

- [docs/install-next-app-router.md](./docs/install-next-app-router.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/agent-pickerd/README.md](./tools/agent-pickerd/README.md)

## License

[MIT](./LICENSE)
