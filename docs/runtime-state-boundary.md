# Runtime State Boundary

Kuma Studio is a portable operator bundle. Its state model keeps a strict
3-way boundary:

1. public repo `kuma-studio`
2. private repo `kuma-studio-private`
3. local-only runtime and secrets

## 1. Track in the public repo

- source code under `packages/` and `scripts/`
- reusable skills under `skills/`
- public docs and diagrams
- templates such as [`config/projects.example.json`](../config/projects.example.json)
- bootstrap code that knows how to work with private state without shipping it

## 2. Track in the private repo

- `vault/`
- `plans/`
- `team.json`

This is the canonical operator brain layer. It is separate from the public repo
and should be committed to a private remote, not copied back into
`kuma-studio`.

## 3. Keep local-only and untracked

- `~/.kuma/runtime/`
- `~/.kuma/dispatch/`
- `~/.kuma/cmux/`
- `~/.kuma/projects.json`
- `~/.claude/projects/`
- repo-local runtime folders such as `.kuma/`, `.kuma-picker/`, `.kuma-studio/`, `output/`, `artifacts/`, `.codex-review/`
- secrets, `.env*`, screenshots, caches, logs, `*.task.md`, `*.result.md`

## Rule of thumb

- code or reusable product behavior -> public repo
- operator knowledge or private memory -> private repo
- machine-specific execution state or secrets -> keep local

Bias toward the private repo. If something is part of the long-lived operator
brain, commit it to `kuma-studio-private`; use local-only only when the state
is runtime-only, secret, or safely re-creatable.

If the public repository needs to document a local file format, prefer:

- `*.example.json`
- seed/example markdown
- public docs that describe the structure without shipping personal contents

## Explorer defaults

The Studio file explorer should treat the workspace root as the default trust
boundary.

- Default behavior: expose only `workspaceRoot`
- Optional behavior: set `KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=vault,claude,codex`
  to opt into extra home-level roots when operating privately

## Related

- [`distribution-model.md`](./distribution-model.md) defines the bundle,
  plugin, skill, and slash-command terminology.
- [`private-repo-model.md`](./private-repo-model.md) describes the recommended public/private repo workflow.
- [`dispatch-runtime-home.md`](./dispatch-runtime-home.md) documents the local-only runtime paths under `~/.kuma/dispatch`, `~/.kuma/cmux`, and `~/.kuma/runtime`.
