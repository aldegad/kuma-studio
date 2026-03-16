# Agent Picker

Agent Picker is a repo-first UI selection bridge for coding agents. Clone or subtree this repository into your app, wire a small set of `tsconfig` aliases, and mount the provider to capture DOM selections directly in the host app, sync shared agent notes through `agent-pickerd`, and optionally render a design lab for comparing UI pieces.

## Domains

- `packages/browser-extension/`: unpacked Chrome extension that bridges arbitrary pages into `agent-pickerd`
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

Then open the printed web URL and append `/design-lab`. If `3000` is free, it will usually be [http://127.0.0.1:3000/design-lab](http://127.0.0.1:3000/design-lab).

The example host stores local state in `example/next-host/.agent-picker/`.

## Install Into Your App

Agent Picker is currently designed to be vendored into a host repo.
It is not currently published as installable npm packages.
Use Node.js 20 or newer when working in this repository or wiring the vendored CLI into a host app.

1. add this repo under a stable path such as `apps/web/vendor/agent-picker`
2. add `tsconfig` aliases that map `@agent-picker/picker` and `@agent-picker/design-lab` to that vendored source
3. add a provider near the app shell
4. make sure your host dev/build uses a bundler setup that resolves those aliases; the current Next.js example uses webpack mode
5. run `agent-pickerd` from the vendored CLI path
6. set `NEXT_PUBLIC_AGENT_PICKER_DAEMON_URL` only if the daemon is not running at `http://127.0.0.1:4312`
7. render a `design-lab` client route if you want the board

Detailed integration notes: [docs/install-next-app-router.md](./docs/install-next-app-router.md)

If your host uses Tailwind CSS v4, remember to add an `@source` entry for the vendored Agent Picker source so overlay classes are included in the generated CSS.
The picker sends selections straight to `agent-pickerd`, so you do not need a separate app route just for selection capture.

## Repo Layout

- `packages/picker/`: picker-facing exports for host apps
- `packages/browser-extension/`: optional browser extension bridge for arbitrary websites
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

## Codex Skill

The repo-managed source of truth for the Codex skill lives in [skills/agent-picker/](./skills/agent-picker/).

Install or update the local skill copy with:

```bash
npm run skill:install
```

This syncs the repo skill into `~/.codex/skills/agent-picker` unless `CODEX_HOME` points somewhere else.
Once installed there, the skill is available from other projects on the same machine too.

After you pull new changes, run the same command again to update the installed local copy.

## Common Commands

- `npm run dev`: start the bundled example host and daemon together
- `npm run dev:web`: start only the example host
- `npm run dev:daemon`: start only the daemon
- `npm run build`: build the bundled example host
- `npm run lint`: typecheck the example host
- `npm run typecheck`: typecheck the example host
- `npm run test`: run daemon unit tests
- `npm run agent-pickerd:serve`: start the local daemon for the example host

## Docs

- [docs/install-next-app-router.md](./docs/install-next-app-router.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/agent-pickerd/README.md](./tools/agent-pickerd/README.md)
- [packages/browser-extension/README.md](./packages/browser-extension/README.md)

## License

[MIT](./LICENSE)
