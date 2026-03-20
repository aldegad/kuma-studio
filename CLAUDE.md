# Claude Workflow

- `npm run kuma-pickerd:get-selection` reads the latest selection.
- If the user says `이거 봐줘`, `방금 선택한 거 봐줘`, `see pick1`, `check pick 1`, or `look at selection 2`, read the latest selection first and resolve numbered picks with 1-based indexing.
- Update the picked work card with `npm run kuma-pickerd:set-job-status -- --status in_progress --message "Read the selection and investigating."`
- Finish the same card with `completed` when the work is done and verified.
- Before your final reply, leave a final job-card update summarizing the change and whether it was verified.
