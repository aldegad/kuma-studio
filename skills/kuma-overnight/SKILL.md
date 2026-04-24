---
name: kuma-overnight
description: Control Kuma overnight autonomous mode with `on`, `off`, or `status`, including active-plan preflight before enabling and overnight summary when disabling.
user-invocable: true
---

# /kuma:overnight

Kuma overnight autonomous mode controller. One skill owns the mode; `on`, `off`, and `status` are subcommands.

## Commands

- `/kuma:overnight` or `/kuma:overnight on` — enable overnight mode.
- `/kuma:overnight off` — disable overnight mode and summarize what happened.
- `/kuma:overnight status` — report current flag/API state without changing it.
- Natural language triggers: "야근모드 켜줘", "야근모드 꺼줘", "overnight on", "overnight off".

## SSoT

- Runtime API: `POST /studio/nightmode` and `GET /studio/nightmode` on managed kuma-server port 4312.
- Runtime flag: `~/.kuma/runtime/nightmode.flag` via `packages/server/src/studio/nightmode-store.mjs`.
- Plan state: `status` frontmatter in the configured plans directory.

Do not use `/tmp/kuma-nightmode.flag`; that was a stale path from the removed `overnight-mode` draft.

## `on`

Before enabling, run a plan preflight. Blue/active plans outside the overnight scope must not be left ambiguous.

1. Resolve the plans source through the Studio API when possible:

```bash
curl -sS http://127.0.0.1:4312/studio/plans
```

2. If the API is unavailable, inspect the configured plan directory explicitly:

```bash
find "${KUMA_PLANS_DIR:-${KUMA_STUDIO_WORKSPACE:-$PWD}/.kuma/plans}" \
  -name '*.md' -exec grep -l 'status: active' {} +
```

3. For every active plan outside the overnight scope, ask the user to classify it before enabling:
   - keep active: included in overnight scope.
   - hold: set `status: hold` and a `status_reason`.
   - blocked: set `status: blocked` and a `status_reason`.
   - completed: set `status: completed` if already done.

4. Enable mode:

```bash
curl -sS -X POST http://127.0.0.1:4312/studio/nightmode \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true}'
```

5. Verify:

```bash
curl -sS http://127.0.0.1:4312/studio/nightmode
test -f ~/.kuma/runtime/nightmode.flag
```

6. Report the active overnight scope and continue autonomously within the safety boundaries.

## `off`

1. Disable mode:

```bash
curl -sS -X POST http://127.0.0.1:4312/studio/nightmode \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```

2. Verify:

```bash
curl -sS http://127.0.0.1:4312/studio/nightmode
test ! -f ~/.kuma/runtime/nightmode.flag
```

3. Summarize from plans, dispatch/results, and recent runtime state:
   - completed work
   - blockers
   - decisions made autonomously
   - remaining next steps

4. Return to normal collaboration rules: design decisions and risky actions need user confirmation again.

## `status`

Check both API and flag. If they disagree, report the drift and prefer the API as the operator-facing state.

```bash
curl -sS http://127.0.0.1:4312/studio/nightmode
ls -l ~/.kuma/runtime/nightmode.flag 2>/dev/null || true
```

## Overnight Safety Boundaries

Even when overnight mode is on, do not run these without explicit user confirmation:

- `git push --force`
- `git reset --hard`
- broad `rm -rf`
- DB drop/truncate/down migration
- production deploy/release
- external paid action
- upload of private third-party material

Overnight mode expands autonomy; it does not disable safety gates.

## Retired Names

The old split skills `overnight-on`, `overnight-off`, and `overnight-mode` are retired. Do not reintroduce them as separate skills.
