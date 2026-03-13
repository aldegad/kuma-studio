# agent-pickerd

`agent-pickerd` is Agent Picker's local state daemon.

It is responsible for:
- reading and writing `.agent-picker/scene.json`
- validating scene payloads
- watching files and publishing SSE updates
- exposing selection and agent note endpoints
- providing a CLI for agents and local tooling

The UI reads and writes the scene through the daemon's HTTP/SSE endpoints.
Agents update the same source of truth through the CLI or the shared state files.

## Running the daemon

In the standalone repository:

```bash
npm run dev
```

That starts both the bundled example host and the daemon with a matched URL/port configuration.

If you want only the daemon:

```bash
npm run agent-pickerd:serve
```

Direct CLI usage from the standalone repository:

```bash
node ./packages/server/src/cli.mjs serve --root ./example/next-host
```

In an installed host project, add a root script that points at the vendored CLI path.

`package.json`:

```json
{
  "scripts": {
    "agent-pickerd:serve": "node ./vendor/agent-picker/packages/server/src/cli.mjs serve --root ."
  }
}
```

Then run:

```bash
npm run agent-pickerd:serve
```

Direct CLI usage from an installed host:

```bash
node ./vendor/agent-picker/packages/server/src/cli.mjs serve --root .
```

The default address is `http://127.0.0.1:4312`.
State files live under the selected host root's `.agent-picker/` directory.
For installed hosts, treat that directory as local state and add `.agent-picker/` to `.gitignore`.

## HTTP API

- `GET /health`
- `GET /scene`
- `GET /agent-note`
- `GET /events`
- `PUT /scene`
- `POST /scene/nodes`
- `PATCH /scene/nodes/:id`
- `DELETE /scene/nodes/:id`
- `GET /dev-selection`
- `POST /dev-selection`
- `DELETE /dev-selection`
- `POST /agent-note`
- `DELETE /agent-note`

## CLI examples

Standalone repository:

```bash
node ./packages/server/src/cli.mjs get-scene --root ./example/next-host
node ./packages/server/src/cli.mjs get-selection --root ./example/next-host
node ./packages/server/src/cli.mjs get-agent-note --root ./example/next-host
node ./packages/server/src/cli.mjs set-agent-note --root ./example/next-host --author codex --status fixed --message "Updated the selected element."
node ./packages/server/src/cli.mjs add-node --root ./example/next-host --id node-welcome-01 --item-id draft-cards-welcomecard --title "Welcome Card" --viewport original --x 120 --y 80 --z-index 1
```

Installed host project:

```bash
node ./vendor/agent-picker/packages/server/src/cli.mjs get-scene --root .
node ./vendor/agent-picker/packages/server/src/cli.mjs get-selection --root .
node ./vendor/agent-picker/packages/server/src/cli.mjs get-agent-note --root .
node ./vendor/agent-picker/packages/server/src/cli.mjs set-agent-note --root . --author codex --status fixed --message "Updated the selected element."
```
