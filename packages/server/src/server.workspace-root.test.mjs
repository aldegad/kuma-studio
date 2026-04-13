import { describe, expect, it } from "vitest";

import { resolveStudioWorkspaceRoot } from "./server.mjs";

describe("resolveStudioWorkspaceRoot", () => {
  it("prefers KUMA_STUDIO_WORKSPACE over the repo root", () => {
    expect(
      resolveStudioWorkspaceRoot(
        "/tmp/repo",
        "/tmp/workspace",
      ),
    ).toBe("/tmp/workspace");
  });

  it("falls back to the repo root when the workspace binding is blank", () => {
    expect(resolveStudioWorkspaceRoot("/tmp/repo", "   ")).toBe("/tmp/repo");
  });
});
