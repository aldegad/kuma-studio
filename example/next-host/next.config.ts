import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pickerEntry = path.resolve(repoRoot, "packages/picker/src/index.ts");
const designLabEntry = path.resolve(repoRoot, "packages/design-lab/src/index.ts");
const designLabSource = path.resolve(repoRoot, "packages/design-lab/src");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@agent-picker/picker": pickerEntry,
      "@agent-picker/design-lab": designLabEntry,
      "@agent-picker/design-lab/registry": path.join(designLabSource, "registry.ts"),
      "@agent-picker/design-lab/types": path.join(designLabSource, "types.ts"),
    };

    return config;
  },
};

export default nextConfig;
