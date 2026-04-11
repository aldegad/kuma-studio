# Runtime State Boundary

Kuma Studio keeps a strict boundary between:

- repo-tracked product code and reusable templates
- machine-local runtime state and operator-specific data

## Track in Git

- source code under `packages/` and `scripts/`
- reusable skills under `skills/`
- public docs and examples
- templates such as [`config/projects.example.json`](../config/projects.example.json)

## Keep local and untracked

- `~/.kuma/projects.json`
- `~/.kuma/team.json`
- `~/.kuma/vault/`
- `~/.kuma/cmux/`
- `~/.claude/`
- repo-local runtime folders such as `.kuma/`, `.kuma-picker/`, `.kuma-studio/`, `output/`, `artifacts/`, `.codex-review/`

## Rule of thumb

If a file contains any of the following, it should stay out of git:

- personal paths
- other private project names
- operator memory or notes
- runtime logs, task files, result files, screenshots, or local caches

If the repository needs to document a local file format, prefer:

- `*.example.json`
- seed/example markdown
- docs that describe the structure without shipping personal contents

## Explorer defaults

The Studio file explorer should treat the workspace root as the default trust
boundary.

- Default behavior: expose only `workspaceRoot`
- Optional behavior: set `KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=vault,claude,codex`
  to opt into extra home-level roots when operating privately
