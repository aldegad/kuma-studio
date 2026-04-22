import type { ExplorerRootsResponse } from "./api";

export interface ActiveExplorerRoot {
  id: string;
  kind: "workspace" | "system" | "project";
  path: string;
}

export function resolveActiveExplorerRoot(
  explorerRoots: ExplorerRootsResponse | null,
  activeProjectId: string | null | undefined,
): ActiveExplorerRoot | null {
  if (!explorerRoots) {
    return null;
  }

  if (!activeProjectId) {
    return {
      id: "workspace",
      kind: "workspace",
      path: explorerRoots.workspaceRoot,
    };
  }

  if (activeProjectId === "system") {
    return {
      id: "system",
      kind: "system",
      path: explorerRoots.systemRoot,
    };
  }

  const projectRoot = explorerRoots.projectRoots[activeProjectId];
  if (!projectRoot) {
    return null;
  }

  return {
    id: activeProjectId,
    kind: "project",
    path: projectRoot,
  };
}

export function formatMissingExplorerRootMessage(activeProjectId: string | null | undefined): string {
  if (activeProjectId && activeProjectId !== "system") {
    return `프로젝트 루트가 등록되지 않았습니다: ${activeProjectId}`;
  }

  return "탐색기 루트를 확인할 수 없습니다.";
}
