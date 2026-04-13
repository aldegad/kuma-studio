---
name: kuma:clear
description: Clear a Kuma worker session context. `/kuma:clear <member>` for one, `/kuma:clear all` for the full team. Optional `--project <name>` filter.
argument-hint: "<member|all> [--project <project>]"
---

EXECUTE IMMEDIATELY.

## Argument Parsing

Parse `$ARGUMENTS`:

- First token = target. `all` (or empty) → clear the whole team. Otherwise treat as member query.
- `--project <name>` (optional) — restrict scope.

## Execution

**Whole team:**

```bash
~/.kuma/bin/kuma-clear-all [--project <project>]
```

**Single member:**

```bash
~/.kuma/bin/kuma-clear <member> [--project <project>]
```

## Protected surfaces (never cleared)

`surface:1` (쿠마 main), `kuma-server`, `kuma-frontend`, system-owned workers such as `노을이` and `쭈니`. The bin enforces this — do not bypass.

## Reporting

After the command returns, report which member contexts were cleared. `all` requires `KUMA_CLEAR_CONFIRM=1`; without it, the bin warns and exits without sending `/clear`.
