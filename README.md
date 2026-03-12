# Agent Picker

Agent Picker is a package-first UI selection bridge for coding agents. The core picker mounts into your running app, captures DOM selections, and syncs shared agent notes through `agent-pickerd`. A separate workspace package powers the optional draft playground.

## Packages

- `@agent-picker/picker`: app-shell provider and devtools overlay
- `@agent-picker/workspace`: draft board UI and workspace item types
- `@agent-picker/next`: Next.js route exports for selection capture
- `@agent-picker/server`: `agent-pickerd` CLI and daemon entrypoint
- `@agent-picker/react`: compatibility re-export for older integrations

The repository ships with a bundled Next.js example host and can also be vendored into a product codebase.

## Quick Start

```bash
pnpm install
pnpm run dev
```

In another terminal:

```bash
pnpm run agent-pickerd:serve
```

Then open [http://127.0.0.1:3000/playground](http://127.0.0.1:3000/playground).

The example host stores local state in `example/next-host/.agent-picker/`.
Installed hosts should add `.agent-picker/` to `.gitignore`.

## Preferred Integration

Keep the picker core and the draft workspace separate:

- mount `AgentPickerProvider` near your app shell
- render `AgentPickerWorkspace` only on your draft playground route
- pass draft items into that route
- re-export the selection route from `@agent-picker/next`
- run `agent-pickerd`

```tsx
import { AgentPickerProvider } from "@agent-picker/picker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AgentPickerProvider showDevtoolsInDevelopment>
      {children}
    </AgentPickerProvider>
  );
}
```

```tsx
"use client";

import { AgentPickerWorkspace } from "@agent-picker/workspace";
import { generatedAgentPickerDraftItems } from "@/lib/agent-picker/generated-drafts";

export function DraftWorkspace() {
  return <AgentPickerWorkspace items={generatedAgentPickerDraftItems} />;
}
```

```tsx
import { DraftWorkspace } from "@/components/agent-picker/DraftWorkspace";

export default function PlaygroundPage() {
  return <DraftWorkspace />;
}
```

```ts
export { dynamic, GET, POST } from "@agent-picker/next";
```

Detailed integration notes: [docs/install-next-app-router.md](./docs/install-next-app-router.md)

## Repo Layout

- `packages/picker/`: picker core provider and devtools overlay
- `packages/workspace/`: draft workspace UI and registry helpers
- `packages/next/`: Next.js selection route exports
- `packages/server/`: `agent-pickerd` package entrypoints
- `packages/react/`: compatibility facade across picker and workspace
- `web/`: shared UI primitives, scene hooks, and devtools internals
- `tools/agent-pickerd/`: local state daemon and CLI
- `tools/init/`: legacy vendored installer for supported app types
- `scripts/`: draft generation, dev orchestration, and QA helpers
- `example/next-host/`: smoke-test host app for the standalone repository

## Agent Workflow

Agent Picker has a shared selection and note model so multiple coding agents can coordinate.

- latest selection: `pnpm run agent-pickerd:get-selection`
- latest note: `pnpm run agent-pickerd:get-agent-note`
- update note: `pnpm run agent-pickerd:set-agent-note -- --author codex --status in_progress --message "..."`

Agent-specific guidance lives here:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [GEMINI.md](./GEMINI.md)

## Common Commands

- `pnpm run dev`: start the bundled example host
- `pnpm run build`: build the bundled example host
- `pnpm run lint`: typecheck the example host
- `pnpm run test`: run daemon unit tests
- `pnpm run qa:agent-picker`: capture smoke-test screenshots with Playwright
- `pnpm run init`: run the legacy vendored installer from a host project root

## Docs

- [docs/install-next-app-router.md](./docs/install-next-app-router.md)
- [docs/maintainers.md](./docs/maintainers.md)
- [tools/agent-pickerd/README.md](./tools/agent-pickerd/README.md)

## License

[MIT](./LICENSE)
