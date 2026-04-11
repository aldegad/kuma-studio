# Kuma Studio

Kuma Studio is an AI agent virtual office and browser automation bridge with a
visual dashboard and team characters.

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

## License

The source code in this repository is licensed under the Apache License,
Version 2.0. See [LICENSE](./LICENSE).

The project's names, logos, character names, character artwork, and other brand
identity assets are not licensed under Apache-2.0. See [NOTICE](./NOTICE),
[TRADEMARKS.md](./TRADEMARKS.md), and [BRAND_ASSETS.md](./BRAND_ASSETS.md).

In short: you may use, fork, and modify the code, but you may not present the
original Kuma Studio identity, characters, or branding as your own without
permission.
