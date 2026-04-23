import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("package.json scripts", () => {
  it("binds server start and reload scripts to the caller workspace by default", () => {
    const packageJsonPath = resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    expect(packageJson.scripts?.["server:start"]).toContain("KUMA_STUDIO_WORKSPACE");
    expect(packageJson.scripts?.["server:start"]).toContain("node ./scripts/resolve-default-workspace.mjs");
    expect(packageJson.scripts?.["server:reload"]).toContain("KUMA_STUDIO_WORKSPACE");
    expect(packageJson.scripts?.["server:reload"]).toContain("node ./scripts/resolve-default-workspace.mjs");
    expect(packageJson.scripts?.["server:reload"]).toContain("bash ./scripts/server-reload.sh");
  });
});
