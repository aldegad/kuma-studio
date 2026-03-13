# Install Into a Next.js App Router Host

Agent Picker's current integration model is repo-first. Vendor the repository into your host app, then point a few aliases at the vendored source.

## Put Agent Picker In Your Repo

The cleanest current setup is to keep Agent Picker under a stable folder such as:

```text
apps/web/vendor/agent-picker
```

That can come from `git subtree`, a direct clone, or a copied folder inside your host repo.

## tsconfig Aliases

Point the host at the vendored source instead of installing internal packages:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@agent-picker/picker": [
        "./vendor/agent-picker/packages/picker/src/index.ts"
      ],
      "@agent-picker/design-lab": [
        "./vendor/agent-picker/packages/design-lab/src/index.ts"
      ],
      "@agent-picker/design-lab/*": [
        "./vendor/agent-picker/packages/design-lab/src/*"
      ]
    }
  }
}
```

If your app uses `src/app`, adjust those paths to match your actual folder depth.

## Next Config

Next.js should also resolve those aliases at bundler time:

```ts
import path from "node:path";
import type { NextConfig } from "next";

const agentPickerRoot = path.resolve(process.cwd(), "./vendor/agent-picker");

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(agentPickerRoot, "..", "..", ".."),
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@agent-picker/picker": path.join(agentPickerRoot, "packages/picker/src/index.ts"),
      "@agent-picker/design-lab": path.join(
        agentPickerRoot,
        "packages/design-lab/src/index.ts",
      ),
      "@agent-picker/design-lab/registry": path.join(
        agentPickerRoot,
        "packages/design-lab/src/registry.ts",
      ),
      "@agent-picker/design-lab/types": path.join(
        agentPickerRoot,
        "packages/design-lab/src/types.ts",
      ),
    };

    return config;
  },
};

export default nextConfig;
```

If the host uses Tailwind CSS v4, point the scanner at the vendored source too:

```css
@import "tailwindcss";
@source "../vendor/agent-picker";
```

## Host Scripts

Add daemon scripts at the host root so coding agents have a stable command surface:

```json
{
  "scripts": {
    "agent-pickerd:serve": "node ./vendor/agent-picker/packages/server/src/cli.mjs serve --root .",
    "agent-pickerd:get-scene": "node ./vendor/agent-picker/packages/server/src/cli.mjs get-scene --root .",
    "agent-pickerd:get-selection": "node ./vendor/agent-picker/packages/server/src/cli.mjs get-selection --root .",
    "agent-pickerd:get-agent-note": "node ./vendor/agent-picker/packages/server/src/cli.mjs get-agent-note --root .",
    "agent-pickerd:set-agent-note": "node ./vendor/agent-picker/packages/server/src/cli.mjs set-agent-note --root .",
    "agent-pickerd:clear-agent-note": "node ./vendor/agent-picker/packages/server/src/cli.mjs clear-agent-note --root ."
  }
}
```

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

## Design-Lab Route

Render your design-lab items directly on a client route:

```tsx
"use client";

import type { ComponentType } from "react";
import {
  AgentPickerDesignLab,
  type AgentPickerComponentItem,
} from "@agent-picker/design-lab";
import WelcomeCard from "@/components/agent-picker/WelcomeCard";

const designLabItems: AgentPickerComponentItem[] = [
  {
    id: "draft-welcome-card",
    title: "Welcome Card",
    shortLabel: "Welcome Card",
    sourceKind: "draft",
    category: "cards",
    componentPath: "src/components/agent-picker/WelcomeCard.tsx",
    tags: ["welcome", "card", "example"],
    recommendedViewport: "desktop",
    renderKind: "component",
    Component: WelcomeCard as ComponentType<Record<string, unknown>>,
    props: {},
  },
];

export default function DesignLabPage() {
  return <AgentPickerDesignLab items={designLabItems} />;
}
```

Keep the items inline if the route is small, or move them into a nearby `design-lab-items.tsx` file.

## Daemon and Dev Server

From the host project root, run the daemon and your usual dev server:

```bash
npm run agent-pickerd:serve
npm run dev
```

Useful shared-agent commands:

```bash
npm run agent-pickerd:get-selection
npm run agent-pickerd:get-agent-note
npm run agent-pickerd:set-agent-note -- --author codex --status in_progress --message "Investigating the selected UI."
```

## Git Ignore

Treat `.agent-picker/` as local state and add it to your host `.gitignore`:

```gitignore
.agent-picker/
```
