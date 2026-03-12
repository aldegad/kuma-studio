# Install Into a Next.js App Router Host

Agent Picker's current integration model is package-first. There is no installer step.

## Install the Packages

Use the package manager you prefer. For a published release, the npm form looks like this:

```bash
npm install @agent-picker/picker @agent-picker/design-lab @agent-picker/server
```

If you are testing from a local clone before publication, workspace-link or file-link the same packages instead.

## Next Config

The UI packages ship as source, so a Next.js host should transpile them:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@agent-picker/picker",
    "@agent-picker/design-lab",
  ],
};

export default nextConfig;
```

If the host uses Tailwind CSS v4, point the scanner at Agent Picker's source too:

```css
@import "tailwindcss";
@source "../node_modules/@agent-picker";
```

For a monorepo or local file-link, use the equivalent relative path to the cloned package source.

## Host Scripts

Add daemon scripts at the host root so coding agents have a stable command surface:

```json
{
  "scripts": {
    "agent-pickerd:serve": "agent-pickerd serve --root .",
    "agent-pickerd:get-scene": "agent-pickerd get-scene --root .",
    "agent-pickerd:get-selection": "agent-pickerd get-selection --root .",
    "agent-pickerd:get-agent-note": "agent-pickerd get-agent-note --root .",
    "agent-pickerd:set-agent-note": "agent-pickerd set-agent-note --root .",
    "agent-pickerd:clear-agent-note": "agent-pickerd clear-agent-note --root ."
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

From the host project root:

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
