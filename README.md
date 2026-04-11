# Kuma Studio

Kuma Studio is an AI agent virtual office and browser automation bridge with a
visual dashboard and team characters.

## Open Source Status

Kuma Studio is open source, but its supported distribution model is currently
`git clone` plus the bundled installer.

- Supported today: clone the repository, run `npm install`, then run
  `node scripts/install.mjs`
- Not promised yet: npm registry publishing for the whole workspace as a single
  global package
- Runtime state stays machine-local under `~/.kuma`, `~/.claude`, and other
  ignored directories

## Quick Start

```bash
git clone https://github.com/aldegad/kuma-studio.git
cd kuma-studio
npm install
node scripts/install.mjs
```

Then:

1. Load `packages/browser-extension/` in Chrome via `chrome://extensions`
2. Pick your top-level work root, not the `kuma-studio` repo clone, as the runtime workspace
3. Start the daemon with that workspace bound:

```bash
cd /path/to/workspace-root
KUMA_STUDIO_WORKSPACE="$PWD" npm run --prefix /path/to/kuma-studio server:reload
```

4. Run `npm run --prefix /path/to/kuma-studio kuma-studio:dashboard`
5. If something looks off, run `npm run --prefix /path/to/kuma-studio skill:doctor`

## Workspace Root Model

Kuma Studio is designed to be installed from this repository, but operated
against your top-level work root.

- The repository clone is the tool source.
- The runtime workspace is the directory you actually want Kuma to supervise.
- By default, plans resolve from `<workspace-root>/.kuma/plans`.
- If you launch the daemon from the repo clone, bind the real workspace with
  `KUMA_STUDIO_WORKSPACE=/path/to/workspace-root`.

## Local State Boundary

This repository tracks product code, reusable skills, and public templates. It
does not track personal runtime state such as local project registries, memory,
vault contents, review artifacts, screenshots, or machine-specific paths.

- Use [`config/projects.example.json`](./config/projects.example.json) as the
  format reference for the machine-local `~/.kuma/projects.json`.
- See [`docs/runtime-state-boundary.md`](./docs/runtime-state-boundary.md) for
  the repo-vs-runtime boundary used for open-source distribution.
- The Studio file explorer now exposes only the workspace root by default. To
  opt into home-level roots such as `vault`, `claude`, or `codex`, set
  `KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=vault,claude,codex`.

## Main Commands

- `npm run server:reload`: restart the daemon on port `4312`
- `npm run dev:studio`: run the Studio web UI in Vite dev mode
- `npm run build:studio`: build the production Studio bundle
- `npm test`: run the Vitest suite
- `npm run skill:doctor`: validate the local Kuma install

## License

The source code in this repository is licensed under the Apache License,
Version 2.0. See [LICENSE](./LICENSE).

The project's names, logos, character names, character artwork, and other brand
identity assets are not licensed under Apache-2.0. See [NOTICE](./NOTICE),
[TRADEMARKS.md](./TRADEMARKS.md), and [BRAND_ASSETS.md](./BRAND_ASSETS.md).

In short: you may use, fork, and modify the code, but you may not present the
original Kuma Studio identity, characters, or branding as your own without
permission.
