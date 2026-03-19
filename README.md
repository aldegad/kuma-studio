<p align="center">
  <img src="./packages/browser-extension/assets/icons/kuma-picker-icon-128.png" alt="Kuma Picker icon" width="96" height="96" />
</p>

# Kuma Picker

Kuma Picker is an extension-first UI selection bridge for coding agents. The default install path is the local daemon plus the Chrome extension bridge, so you can inspect and control arbitrary web pages without modifying the target app. An embedded host mode with the picker/provider and design-lab still exists, but it is optional and currently experimental.

## Domains

- `packages/browser-extension/`: unpacked Chrome extension that bridges arbitrary pages into `kuma-pickerd`
- `packages/picker/`: app-shell provider and devtools overlay
- `packages/design-lab/`: design-lab board UI and item types
- `packages/server/`: `kuma-pickerd` entrypoint shim
- `web/`: shared UI primitives, scene hooks, and devtools internals
- `tools/kuma-pickerd/`: local state daemon implementation

## Develop This Repo

```bash
npm install
npm run dev
```

`npm run dev` starts both the example web host and `kuma-pickerd`, and automatically keeps the web app pointed at the daemon even when the default ports are occupied.

Then open the printed web URL and append `/design-lab`. If `3000` is free, it will usually be [http://127.0.0.1:3000/design-lab](http://127.0.0.1:3000/design-lab).

Kuma Picker stores shared runtime state in `~/.codex/kuma-picker/` by default, or in `$CODEX_HOME/kuma-picker/` when `CODEX_HOME` is set.
Browser control commands such as `browser-context` and `browser-click` run over the daemon's WebSocket control plane.

## Core Install

The default local install is:

```bash
npm run skill:install
```

This installs only the core extension-first workflow:

- the skill into `~/.codex/skills/kuma-picker`
- the Chrome extension into `~/.codex/extensions/kuma-picker-browser-extension`

It does not install anything into your current app repo.
It also does not enable the embedded picker/provider or design-lab host mode by default.

If `CODEX_HOME` is set, both install paths move under that directory instead.

In Chrome, use `Load unpacked` and point it at `~/.codex/extensions/kuma-picker-browser-extension`.

After you pull new changes, run the same command again to update the installed local copy.

## Optional Experimental Host Embedding

Kuma Picker is currently designed to be vendored into a host repo.
It is not currently published as installable npm packages.
Use Node.js 20 or newer when working in this repository or wiring the vendored CLI into a host app.

This path is optional.
You do not need it for the browser extension workflow.
Treat it as experimental host embedding for teams that want an in-app picker/provider or a design-lab route.

1. add this repo under a stable path such as `apps/web/vendor/kuma-picker`
2. add `tsconfig` aliases that map `@kuma-picker/picker` and `@kuma-picker/design-lab` to that vendored source
3. add a provider near the app shell
4. make sure your host dev/build uses a bundler setup that resolves those aliases; the current Next.js example uses webpack mode
5. run `kuma-pickerd` from the vendored CLI path
6. set `NEXT_PUBLIC_KUMA_PICKER_DAEMON_URL` only if the daemon is not running at `http://127.0.0.1:4312`
7. render a `design-lab` client route if you want the board

Detailed integration notes: [docs/install-next-app-router.md](./docs/install-next-app-router.md)

If your host uses Tailwind CSS v4, remember to add an `@source` entry for the vendored Kuma Picker source so overlay classes are included in the generated CSS.
The picker sends selections straight to `kuma-pickerd`, so you do not need a separate app route just for selection capture.

## Repo Layout

- `packages/picker/`: picker-facing exports for host apps
- `packages/browser-extension/`: optional browser extension bridge for arbitrary websites
- `packages/design-lab/`: design-lab-facing exports for host apps
- `packages/server/`: CLI shim kept close to the repo root
- `web/`: internal implementation shared by those domains
- `tools/kuma-pickerd/`: daemon implementation and local-state rules
- `scripts/`: standalone example runtime wiring
- `example/next-host/`: smoke-test host app using the same alias model as consumers

## Agent Workflow

Kuma Picker has a shared selection and note model so multiple coding agents can coordinate.

- latest selection: `npm run kuma-pickerd:get-selection`
- latest note: `npm run kuma-pickerd:get-agent-note`
- browser extension status: `npm run kuma-pickerd:get-extension-status`
- update note: `npm run kuma-pickerd:set-agent-note -- --author codex --status in_progress --message "..."`

If no saved selection exists yet, `set-agent-note` falls back to a shared global picker note instead of failing.

Agent-specific guidance lives here:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [GEMINI.md](./GEMINI.md)

## Codex Skill

The repo-managed source of truth for the Codex skill lives in [skills/kuma-picker/](./skills/kuma-picker/).
Use `npm run skill:install` for the core extension-first workflow described above.

## Common Commands

- `npm run dev`: start the bundled example host and daemon together
- `npm run dev:web`: start only the example host
- `npm run dev:daemon`: start only the daemon
- `npm run build`: build the bundled example host
- `npm run lint`: typecheck the example host
- `npm run typecheck`: typecheck the example host
- `npm run test`: run daemon unit tests
- `npm run kuma-pickerd:serve`: start the local daemon for the example host
- `npm run kuma-pickerd:get-extension-status`: show the latest browser extension presence/status seen by the daemon

## Docs

- [docs/install-next-app-router.md](./docs/install-next-app-router.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/kuma-pickerd/README.md](./tools/kuma-pickerd/README.md)
- [packages/browser-extension/README.md](./packages/browser-extension/README.md)

## License

[MIT](./LICENSE)
