# Claude Workflow

- In the standalone repository, `npm run kuma-pickerd:get-selection` reads the latest selection for `example/next-host`.
- In an installed host project, run the host root `kuma-pickerd:get-selection` script before using other inspection methods.
- If the user says `이거 봐줘`, `방금 선택한 거 봐줘`, `see pick1`, `check pick 1`, or `look at selection 2`, read the latest selection first and resolve numbered picks with 1-based indexing.
- Acknowledge picked work with `npm run kuma-pickerd:set-agent-note -- --author claude --status acknowledged --message "Read the selection and investigating."`
- Move the shared note through `in_progress`, `fixed`, or `needs_reselect` while you work.
- Before your final reply, leave a final note summarizing the change and whether it was verified.
