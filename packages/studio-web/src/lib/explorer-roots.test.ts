import { describe, expect, it } from "vitest";

import type { ExplorerRootsResponse } from "./api";
import { formatMissingExplorerRootMessage, resolveActiveExplorerRoot } from "./explorer-roots";

const ROOTS: ExplorerRootsResponse = {
  workspaceRoot: "/workspace",
  systemRoot: "/system",
  projectRoots: {
    "kuma-studio": "/workspace/personal/kuma-studio",
    "alpha-project": "/workspace/apps/alpha-project",
  },
  globalRoots: {
    vault: "/Users/test/.kuma/vault",
  },
};

describe("resolveActiveExplorerRoot", () => {
  it("uses the workspace root when no project is active", () => {
    expect(resolveActiveExplorerRoot(ROOTS, null)).toEqual({
      id: "workspace",
      kind: "workspace",
      path: "/workspace",
    });
  });

  it("uses the system root for the system project", () => {
    expect(resolveActiveExplorerRoot(ROOTS, "system")).toEqual({
      id: "system",
      kind: "system",
      path: "/system",
    });
  });

  it("uses the canonical registered project root without guessing paths", () => {
    expect(resolveActiveExplorerRoot(ROOTS, "alpha-project")).toEqual({
      id: "alpha-project",
      kind: "project",
      path: "/workspace/apps/alpha-project",
    });
    expect(resolveActiveExplorerRoot(ROOTS, "missing-project")).toBeNull();
  });
});

describe("formatMissingExplorerRootMessage", () => {
  it("reports the missing project id directly", () => {
    expect(formatMissingExplorerRootMessage("missing-project")).toBe(
      "프로젝트 루트가 등록되지 않았습니다: missing-project",
    );
  });
});
