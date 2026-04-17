# Dispatch Runtime Home

Kuma Studio dispatch runtime state now lives under `~/.kuma`, not `/tmp`, by default.

This keeps active task and result artifacts on disk across normal reboots and makes recovery less fragile.

## Canonical Paths

- dispatch tasks: `~/.kuma/dispatch/tasks/`
- dispatch results: `~/.kuma/dispatch/results/`
- dispatch signals: `~/.kuma/dispatch/signals/`
- cmux surface registry: `~/.kuma/cmux/surfaces.json`
- runtime state: `~/.kuma/runtime/`
- night mode flag: `~/.kuma/runtime/nightmode.flag`
- vault ingest stamps: `~/.kuma/runtime/vault-ingest/`

## Source Of Truth

- Canonical dispatch lifecycle source: broker state via `kuma-studio dispatch-status --task-file <task-file>`
- Broker persistence: repo-local `.kuma-studio/dispatch-broker.json`
- Vault files such as `dispatch-log.md` are derived recovery rails, not the primary source of truth

## Why This Changed

The older `/tmp/kuma-*` layout made important operator state vulnerable to abrupt reboots or crashes.

The new home-based layout keeps the important files in a stable private runtime root:

- task files survive normal restart flows
- result files are less likely to disappear before ingest or QA
- signal and registry paths stay aligned with the rest of Kuma runtime state

## Recovery Rule

If dispatch looks inconsistent after restart:

1. Read `~/.kuma/vault/dispatch-log.md`
2. Re-check broker state with `kuma-studio dispatch-status --task-file <task-file>`
3. Use `~/.kuma/dispatch/tasks/` and `~/.kuma/dispatch/results/` as the first artifact locations to inspect

## Legacy Note

Older docs, prompts, test fixtures, or historical results may still mention `/tmp/kuma-*`.

Treat those as legacy paths unless the environment explicitly overrides:

- `KUMA_TASK_DIR`
- `KUMA_RESULT_DIR`
- `KUMA_SIGNAL_DIR`
- `KUMA_SURFACES_PATH`
- `KUMA_NIGHTMODE_FLAG`
- `KUMA_VAULT_INGEST_STAMP_DIR`
