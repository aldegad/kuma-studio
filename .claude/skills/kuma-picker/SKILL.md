---
name: kuma-picker
description: Read the latest Kuma Picker selection, screenshot, job state, and browser bridge status before working on picked UI or browser-driven investigation. Use when the user mentions Kuma Picker, a picked element, a saved selection, browser extension control, tab inspection, DOM reads, clicks, screenshots, or shorthand like "check pick 1", and when work should start from the shared Kuma Picker state home.
---

# Kuma Picker (project-local)

This is the kuma-picker repo itself. Use `npm run kuma-pickerd:*` directly.

For the full skill reference, see [skills/kuma-picker/SKILL.md](../../../skills/kuma-picker/SKILL.md).
For command examples, see [skills/kuma-picker/references/commands.md](../../../skills/kuma-picker/references/commands.md).

## Quick reference

```bash
npm run kuma-pickerd:serve
npm run kuma-pickerd:get-selection
npm run kuma-pickerd:get-browser-session
npm run kuma-pickerd:set-job-status -- --status in_progress --message "Working on it."
npm run kuma-pickerd:set-job-status -- --status completed --message "Done."
npm run skill:doctor
```
