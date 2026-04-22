import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("package.json scripts", () => {
  it("does not force the repo cwd into KUMA_STUDIO_WORKSPACE during server reload", () => {
    const packageJsonPath = resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    expect(packageJson.scripts?.["server:reload"]).toBe("bash ./scripts/server-reload.sh");
    expect(packageJson.scripts?.["server:reload"]).not.toContain("KUMA_STUDIO_WORKSPACE");
  });
});
