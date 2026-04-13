---
name: kuma:kill
description: Kill a Kuma worker surface. `/kuma:kill <member>` for one, `/kuma:kill all` for the full team. Optional `--project <name>` filter.
argument-hint: "<member|all> [--project <project>]"
---

EXECUTE IMMEDIATELY.

## Argument Parsing

Parse `$ARGUMENTS`:

- First token = target. `all` (or empty) → kill the whole team. Otherwise treat as member query.
- `--project <name>` (optional) — restrict scope.
- `--surface <id>` (optional, single-target only) — kill a specific surface ID instead of looking up by name.

## Execution

**Whole team:**

```bash
~/.kuma/bin/kuma-kill-all [--project <project>]
```

**Single member:**

```bash
~/.kuma/bin/kuma-kill <member> [--project <project>]
# or
~/.kuma/bin/kuma-kill --surface <surface-id>
```

## Protected surfaces (never killed)

`surface:1` (쿠마 main), `kuma-server`, `kuma-frontend`. The bin enforces this — do not bypass.

## Reporting

After the command returns, run `kuma-status` and report which surfaces went down. Respawn is a separate skill (`/kuma:spawn` or `/kuma:restart`).

## Notes

- This skill replaces the old `kill-all` skill (now deleted).
