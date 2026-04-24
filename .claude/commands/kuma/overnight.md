---
name: kuma:overnight
description: Control Kuma overnight autonomous mode. `/kuma:overnight` defaults to on; use `/kuma:overnight off` or `/kuma:overnight status`.
argument-hint: "[on|off|status]"
---

EXECUTE IMMEDIATELY.

## Routing

Parse `$ARGUMENTS`:

- empty or `on` -> run the `kuma-overnight` skill with `on`.
- `off` -> run the `kuma-overnight` skill with `off`.
- `status` -> run the `kuma-overnight` skill with `status`.
- any other text -> infer `on/off/status` from the text; if ambiguous, print the three valid forms.

```
/kuma:overnight
/kuma:overnight on
/kuma:overnight off
/kuma:overnight status
```

## Notes

- `kuma-overnight` is the canonical skill.
- The retired split names `overnight-on`, `overnight-off`, and `overnight-mode` must not be used.
