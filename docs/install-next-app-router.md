# Install Into a Next.js App Router Host

Agent Picker's preferred integration style is package-oriented:

- `@agent-picker/picker` for the app-shell provider
- `@agent-picker/workspace` for the draft playground page
- `@agent-picker/next` for the selection route
- `@agent-picker/server` for `agent-pickerd`

## Minimal Host Shape

Your host needs four things:

1. Draft sources under `components/agent-picker/drafts`
2. `AgentPickerProvider` near the app shell
3. A route that renders `AgentPickerWorkspace` with the generated draft items
4. A dev selection route export

## Provider

Wrap your app shell with the provider:

```tsx
"use client";

import { AgentPickerProvider } from "@agent-picker/picker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AgentPickerProvider showDevtoolsInDevelopment>
      {children}
    </AgentPickerProvider>
  );
}
```

## Playground Route

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

## Selection Route

Create `app/api/devtools/selection/route.ts` or `src/app/api/devtools/selection/route.ts`:

```ts
export { dynamic, GET, POST } from "@agent-picker/next";
```

## Daemon

From the host project root:

```bash
pnpm run agent-pickerd:serve
pnpm run agent-picker:web:dev
```

Useful agent commands:

```bash
pnpm run agent-pickerd:get-selection
pnpm run agent-pickerd:get-agent-note
pnpm run agent-pickerd:set-agent-note -- --author codex --status in_progress --message "Investigating the selected UI."
```

## Draft Sources

Add draft components and assets under:

```text
src/components/agent-picker/drafts
```

Or, if your alias root is the project root:

```text
components/agent-picker/drafts
```

Agent Picker generates the draft registry and mirrored public assets during `predev` and `prebuild`.

## Compatibility Notes

- `@agent-picker/react` still exists as a compatibility facade, but new work should import `@agent-picker/picker` and `@agent-picker/workspace` directly.
- `tools/init/main.mjs` still exists for vendored installs. It is now considered a compatibility path rather than the preferred package-first model.
- If your team wants a tracked git dependency, a submodule is safer than pushing to a public remote from a private host repo.
- If you prefer a vendored copy without submodules, clone the repo into `vendor/agent-picker` and update it intentionally.
