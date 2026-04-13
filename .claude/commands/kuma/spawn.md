---
name: kuma:spawn
description: Spawn a Kuma worker surface. `/kuma:spawn <member>` for one, `/kuma:spawn all` for the full team. Optional `--project <name>` filter.
argument-hint: "<member|all> [--project <project>]"
---

EXECUTE IMMEDIATELY.

## Argument Parsing

Parse `$ARGUMENTS`:

- First token = target. If `all` (or empty), spawn the whole team. Otherwise treat it as a member query (Korean name, romanization, or emoji+name — `kuma-spawn` normalizes via team.json).
- `--project <name>` (optional) — restrict to one project. If omitted on `all`, spawn every project. If omitted on a single member, the member's home project is auto-resolved.

## Execution

**Whole team:**

```bash
~/.kuma/bin/kuma-spawn-all [--project <project>]
```

**Single member:**

```bash
~/.kuma/bin/kuma-spawn <member> [--project <project>]
```

## Reporting

After the command returns, run `kuma-status` and report:
- Newly spawned surface IDs (single member) or counts (all)
- Any members that failed to spawn
- Skip noise about already-running surfaces — `kuma-spawn` is idempotent

## Notes

- team.json is SSOT for membership. Unknown member name → fail loudly, do not guess.
- system-team members (노을이, 쭈니, 쿠마) auto-route to `project=system`; do not override.
- This skill replaces the old `spawn-all` skill (now deleted).
