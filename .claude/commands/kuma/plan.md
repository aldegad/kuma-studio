---
name: kuma:plan
description: Create or normalize Kuma Plan documents using the canonical Korean plan format.
argument-hint: "[create|normalize|list|status] [target]"
---

# /kuma:plan

Route this command to the `kuma-plan` skill.

Rules:

- Use `kuma-plan` for Plan panel markdown documents.
- Keep titles and checklist text in Korean.
- Keep `status` frontmatter in the parser-owned English enum.
- Resolve the configured plans directory before editing.
- Do not write `.claude/plans`.
