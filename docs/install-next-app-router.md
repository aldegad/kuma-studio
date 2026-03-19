# Experimental: Install Into a Next.js App Router Host

Kuma Picker's current integration model is repo-first. Vendor the repository into your host app, then point a few aliases at the vendored source.
It is not currently published as installable npm packages.
Use Node.js 20 or newer for the vendored CLI and local development workflow.
The example in this repository is currently wired and tested through Next.js webpack mode, so the alias examples below assume the same setup.

This guide is optional.
You do not need any of it if you only want the Chrome extension plus local daemon workflow.
Use it only if you explicitly want the embedded picker/provider or the design-lab route inside your app.

## Put Kuma Picker In Your Repo

The cleanest current setup is to keep Kuma Picker under a stable folder such as:

```text
apps/web/vendor/kuma-picker
```

That can come from `git subtree`, a direct clone, or a copied folder inside your host repo.

## tsconfig Aliases

Point the host at the vendored source instead of installing internal packages:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@kuma-picker/picker": [
        "./vendor/kuma-picker/packages/picker/src/index.ts"
      ],
      "@kuma-picker/design-lab": [
        "./vendor/kuma-picker/packages/design-lab/src/index.ts"
      ],
      "@kuma-picker/design-lab/*": [
        "./vendor/kuma-picker/packages/design-lab/src/*"
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

const hostRoot = process.cwd();
const kumaPickerRoot = path.resolve(hostRoot, "./vendor/kuma-picker");
const workspaceRoot = path.resolve(hostRoot, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@kuma-picker/picker": path.join(kumaPickerRoot, "packages/picker/src/index.ts"),
      "@kuma-picker/design-lab": path.join(
        kumaPickerRoot,
        "packages/design-lab/src/index.ts",
      ),
      "@kuma-picker/design-lab/registry": path.join(
        kumaPickerRoot,
        "packages/design-lab/src/registry.ts",
      ),
      "@kuma-picker/design-lab/types": path.join(
        kumaPickerRoot,
        "packages/design-lab/src/types.ts",
      ),
    };

    return config;
  },
};

export default nextConfig;
```

Set `outputFileTracingRoot` to a common ancestor that contains both the host app and the vendored Kuma Picker source. For a host app in `apps/web` with Kuma Picker in `apps/web/vendor/kuma-picker`, that is usually the monorepo root (`../..` from the host app). If your host lives elsewhere, adjust that path accordingly.

If you use the webpack alias block above, mirror the example host's Next scripts so the same bundler path is active in development and build:

```json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack"
  }
}
```

If the host uses Tailwind CSS v4, point the scanner at the vendored source too:

```css
@import "tailwindcss";
@source "../vendor/kuma-picker";
```

## Host Scripts

Add daemon scripts at the host root so coding agents have a stable command surface:

```json
{
  "scripts": {
    "kuma-pickerd:serve": "node ./vendor/kuma-picker/packages/server/src/cli.mjs serve --root .",
    "kuma-pickerd:get-scene": "node ./vendor/kuma-picker/packages/server/src/cli.mjs get-scene --root .",
    "kuma-pickerd:get-selection": "node ./vendor/kuma-picker/packages/server/src/cli.mjs get-selection --root .",
    "kuma-pickerd:get-agent-note": "node ./vendor/kuma-picker/packages/server/src/cli.mjs get-agent-note --root .",
    "kuma-pickerd:set-agent-note": "node ./vendor/kuma-picker/packages/server/src/cli.mjs set-agent-note --root .",
    "kuma-pickerd:clear-agent-note": "node ./vendor/kuma-picker/packages/server/src/cli.mjs clear-agent-note --root ."
  }
}
```

## Provider

Wrap your app shell with the provider:

```tsx
"use client";

import { KumaPickerProvider } from "@kuma-picker/picker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <KumaPickerProvider showDevtoolsInDevelopment>
      {children}
    </KumaPickerProvider>
  );
}
```

The provider talks directly to `kuma-pickerd`, so you do not need to add a separate Next route just to save selections.

## Design-Lab Route

Render your design-lab items directly on a client route:

```tsx
"use client";

import type { ComponentType } from "react";
import {
  KumaPickerDesignLab,
  type KumaPickerComponentItem,
} from "@kuma-picker/design-lab";
import WelcomeCard from "@/components/kuma-picker/WelcomeCard";

const designLabItems: KumaPickerComponentItem[] = [
  {
    id: "draft-welcome-card",
    title: "Welcome Card",
    shortLabel: "Welcome Card",
    sourceKind: "draft",
    category: "cards",
    componentPath: "src/components/kuma-picker/WelcomeCard.tsx",
    tags: ["welcome", "card", "example"],
    recommendedViewport: "desktop",
    renderKind: "component",
    Component: WelcomeCard as ComponentType<Record<string, unknown>>,
    props: {},
  },
];

export default function DesignLabPage() {
  return <KumaPickerDesignLab items={designLabItems} />;
}
```

Keep the items inline if the route is small, or move them into a nearby `design-lab-items.tsx` file.

## Daemon and Dev Server

From the host project root, run the daemon and your usual dev server:

```bash
npm run kuma-pickerd:serve
npm run dev
```

If the daemon is running somewhere other than `http://127.0.0.1:4312`, expose that URL to the browser with `NEXT_PUBLIC_KUMA_PICKER_DAEMON_URL`.

Useful shared-agent commands:

```bash
npm run kuma-pickerd:get-selection
npm run kuma-pickerd:get-agent-note
npm run kuma-pickerd:set-agent-note -- --author codex --status in_progress --message "Investigating the selected UI."
```

## Git Ignore

Kuma Picker now stores shared runtime state in `~/.codex/kuma-picker/` by default, or in `$CODEX_HOME/kuma-picker/` when `CODEX_HOME` is set. You only need `.gitignore` coverage if you override `KUMA_PICKER_STATE_HOME` into your repo:

```gitignore
# Only if KUMA_PICKER_STATE_HOME points inside this repo:
.kuma-picker/
```
