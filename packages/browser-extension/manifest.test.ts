import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("browser extension manifest", () => {
  it("declares loopback websocket permissions and a minimum Chrome version", () => {
    const manifestPath = path.resolve(process.cwd(), "packages/browser-extension/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining(["ws://127.0.0.1/*", "ws://localhost/*", "wss://127.0.0.1/*", "wss://localhost/*"]),
    );
  });
});
