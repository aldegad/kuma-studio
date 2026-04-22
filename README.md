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
- The installer syncs repo-managed Kuma skills into both `~/.claude/skills` and
  `~/.codex/skills` by default so Claude and Codex stay aligned

## Quick Start

```bash
git clone https://github.com/aldegad/kuma-studio.git
cd kuma-studio
npm install
node scripts/install.mjs
npm run kuma-private:bootstrap
npm run skill:doctor
```

If you only want one agent catalog refreshed, use `--claude-only` or
`--codex-only`.

`npm run kuma-private:bootstrap` creates a sibling `../kuma-studio-private`
target by default, seeds it from your current `~/.kuma/vault`,
`~/.kuma/plans`, and `~/.kuma/team.json` when needed, then relinks those
canonical paths as symlinks.

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

After you bootstrap shared infra surfaces, use `npm run kuma-server:reload` to
reload the daemon inside the existing managed `kuma-server` surface instead of
starting a duplicate local server.

## Workspace Root Model

Kuma Studio is designed to be installed from this repository, but operated
against your top-level work root.

- The repository clone is the tool source.
- The runtime workspace is the directory you actually want Kuma to supervise.
- By default, plans resolve from `<workspace-root>/.kuma/plans`.
- If you launch the daemon from the repo clone, bind the real workspace with
  `KUMA_STUDIO_WORKSPACE=/path/to/workspace-root`.

## Local State Boundary

Kuma Studio uses a 3-way boundary:

- public repo `kuma-studio` — product code, reusable skills, docs, and templates
- private repo `kuma-studio-private` — your canonical `vault/`, `plans/`, and `team.json`
- local-only runtime/secrets — `runtime`, `dispatch`, `cmux`, `projects.json`, `.env*`, caches, screenshots

This public repository does not track personal runtime state such as local
project registries, operator memory, live vault contents, review artifacts,
screenshots, or machine-specific paths.

- Use [`config/projects.example.json`](./config/projects.example.json) as the
  format reference for the machine-local `~/.kuma/projects.json`.
- Use `npm run kuma-private:bootstrap` to bootstrap and relink a sibling
  `kuma-studio-private` repo instead of copying private knowledge into this repo.
- See [`docs/runtime-state-boundary.md`](./docs/runtime-state-boundary.md) for
  the public/private/runtime boundary used for open-source distribution.
- See [`docs/private-repo-model.md`](./docs/private-repo-model.md) for the
  recommended public/private repo workflow and remote setup.
- The Studio file explorer now exposes only the workspace root by default. To
  opt into home-level roots such as `vault`, `claude`, or `codex`, set
  `KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=vault,claude,codex`.

## Public / Private Repo Model

![Kuma Studio public/private repo model](./docs/images/private-repo-model.png)

The important rule is simple:

- code changes -> commit/push `kuma-studio`
- vault, memos, plans, team changes -> commit/push `kuma-studio-private`
- runtime and secrets -> do not commit

`kuma-studio-private` is not a staging area that later gets copied into the
public repo. It is a separate canonical repo for private brain data.

## Main Commands

- `npm run kuma-server:reload`: reload the daemon inside the managed `kuma-server` surface
- `npm run server:reload`: restart the daemon on port `4312`
- `npm run kuma-private:bootstrap`: create/link the sibling `kuma-studio-private` repo
- `npm run kuma-studio:dashboard`: open the Studio UI served by the daemon on port `4312`
- `npm run build:studio`: build the production Studio bundle
- `npm run security:hooks:install`: install the repo-local pre-commit hook that blocks private runtime data and runs `gitleaks`
- `npm run security:scan`: run a full-repo `gitleaks` scan
- `npm run security:scan:staged`: run the same scan against staged changes only
- `npm test`: run the Vitest suite
- `npm run skill:doctor`: validate the local Kuma install

## Secret Guardrails

This repo ships a repo-local pre-commit hook under `.githooks/pre-commit`.

- It blocks staging known private Kuma runtime roots such as `.kuma/`, `.claude/projects/`, top-level `vault/`, `memory/`, `memo/`, and `*.task.md` / `*.result.md`.
- It blocks nested `kuma-studio-private/` clones from being committed inside the public repo.
- It blocks staged references to protected private project identifiers.
- It then runs `gitleaks` against staged changes.
- The hook uses a local `gitleaks` binary when available, or Docker when the daemon is running.

Why the hook has both path rules and `gitleaks`:

- `gitleaks` catches generic secrets such as tokens, passwords, and keys.
- Repo-specific path guards catch private Kuma runtime data that is sensitive even when it does not look like a conventional secret.
- Public structure docs are still allowed. For example, `README.md`, docs about the vault layout, or code that implements vault features are fine to commit. The guard is aimed at actual private runtime content, not architectural explanations.

Install it once per clone with:

```bash
npm run security:hooks:install
```

## License

The source code in this repository is licensed under the Apache License,
Version 2.0. See [LICENSE](./LICENSE).

The project's names, logos, character names, character artwork, and other brand
identity assets are not licensed under Apache-2.0. See [NOTICE](./NOTICE),
[TRADEMARKS.md](./TRADEMARKS.md), and [BRAND_ASSETS.md](./BRAND_ASSETS.md).

In short: you may use, fork, and modify the code, but you may not present the
original Kuma Studio identity, characters, or branding as your own without
permission.
