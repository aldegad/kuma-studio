# Gemini Workflow

- `npm run kuma-pickerd:get-selection` reads the latest selection.
- If the user says "check this," "look at what I just picked," `see pick1`, `check pick 1`, or `look at selection 2`, load the latest selection first and map numbered picks with 1-based indexing.
- Update the picked work card with `npm run kuma-pickerd:set-job-status -- --status in_progress --message "Read the selection and investigating."`
- Finish the same card with `completed` as the task evolves and lands.
- Before replying, leave a final job-card update so the result is visible inside Kuma Picker.
