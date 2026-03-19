# Gemini Workflow

- `npm run kuma-pickerd:get-selection` reads the latest selection.
- If the user says `이거 봐줘`, `방금 선택한 거 봐줘`, `see pick1`, `check pick 1`, or `look at selection 2`, load the latest selection first and map numbered picks with 1-based indexing.
- Post progress with `npm run kuma-pickerd:set-agent-note -- --author gemini --status acknowledged --message "Read the selection and investigating."`
- Update the shared note to `in_progress`, `fixed`, or `needs_reselect` as the task evolves.
- Before replying, leave a final note so the result is visible inside Kuma Picker.
