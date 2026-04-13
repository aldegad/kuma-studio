---
name: kuma:restart
description: Restart a Kuma worker surface (kill + spawn). `/kuma:restart <member>` for one, `/kuma:restart all` for the full team. Optional `--project <name>` filter.
argument-hint: "<member|all> [--project <project>]"
---

EXECUTE IMMEDIATELY.

## Argument Parsing

Parse `$ARGUMENTS`:

- First token = target. `all` (or empty) → restart whole team. Otherwise treat as member query.
- `--project <name>` (optional) — restrict scope.

## Execution

**Whole team:**

```bash
~/.kuma/bin/kuma-restart-all [--project <project>]
```

**Single member:** (no dedicated bin — chain kill + spawn)

```bash
~/.kuma/bin/kuma-kill <member> [--project <project>] || true
~/.kuma/bin/kuma-spawn <member> [--project <project>]
```

`|| true` on kill so a missing/already-dead surface does not block the respawn.

## Reporting

After the command returns, run `kuma-status` and report:
- The new surface ID (single member)
- Any members that failed to come back up

## Notes

- This skill replaces the old `restart-all` skill (now deleted).
- For kill-only or spawn-only, use `/kuma:kill` or `/kuma:spawn` directly.
