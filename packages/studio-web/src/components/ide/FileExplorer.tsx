import { useCallback, useEffect, useRef, useState } from "react";
import { FileTreeNode, type FsNode } from "./FileTreeNode";
import { CodeViewer } from "./CodeViewer";
import { ImageViewer } from "./ImageViewer";

type ViewerFile =
  | { type: "code"; content: string; language: string; path: string }
  | { type: "image"; content: string; mimeType: string; path: string }
  | { type: "binary"; size: number; path: string }
  | null;

interface FileExplorerProps {
  onCollapse?: () => void;
}

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;
const TREE_WIDTH_INITIAL = 260;
const TREE_WIDTH_MIN = 180;
const TREE_WIDTH_MAX = 420;
const WORKSPACE_ROOT = "~/Documents/workspace";
const HOME_DIR = "/Users/soohongkim";

interface GlobalSection {
  id: string;
  label: string;
  icon: string;
  color: string;
  path: string;
}

const GLOBAL_SECTIONS: GlobalSection[] = [
  { id: "claude", label: ".claude", icon: "C", color: "text-violet-500", path: `${HOME_DIR}/.claude` },
  { id: "codex", label: ".codex", icon: "X", color: "text-emerald-500", path: `${HOME_DIR}/.codex` },
];

export function FileExplorer({ onCollapse }: FileExplorerProps) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [globalTrees, setGlobalTrees] = useState<Record<string, FsNode | null>>({});
  const [globalExpanded, setGlobalExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_INITIAL);
  const [viewerFile, setViewerFile] = useState<ViewerFile>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const resizingRef = useRef(false);

  // Fetch root tree
  useEffect(() => {
    setLoading(true);
    fetch(`${BASE_URL}/studio/fs/tree?depth=2`)
      .then((r) => r.json())
      .then((data: FsNode) => {
        setTree(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Load global config tree on demand
  const loadGlobalTree = useCallback(async (section: GlobalSection) => {
    if (globalTrees[section.id]) return;
    try {
      const r = await fetch(`${BASE_URL}/studio/fs/tree?root=${encodeURIComponent(section.path)}&depth=2`);
      const data: FsNode = await r.json();
      setGlobalTrees((prev) => ({ ...prev, [section.id]: data }));
    } catch {
      setGlobalTrees((prev) => ({ ...prev, [section.id]: { name: section.label, path: section.path, type: "dir", children: [] } }));
    }
  }, [globalTrees]);

  const toggleGlobalSection = useCallback((section: GlobalSection) => {
    const willExpand = !globalExpanded[section.id];
    setGlobalExpanded((prev) => ({ ...prev, [section.id]: willExpand }));
    if (willExpand) {
      void loadGlobalTree(section);
    }
  }, [globalExpanded, loadGlobalTree]);

  // Load children for lazy expansion
  const handleLoadChildren = useCallback(async (path: string): Promise<FsNode> => {
    const r = await fetch(`${BASE_URL}/studio/fs/tree?root=${encodeURIComponent(path)}&depth=1`);
    return r.json();
  }, []);

  // File select → load content into viewer
  const handleFileSelect = useCallback(async (path: string) => {
    // If clicking the same file, do nothing
    if (viewerFile && "path" in viewerFile && viewerFile.path === path) return;

    setFileLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/studio/fs/read?path=${encodeURIComponent(path)}`);
      const data = await r.json();
      if (data.error) {
        setFileLoading(false);
        return;
      }
      if (data.binary) {
        setViewerFile({ type: "binary", size: data.size, path });
      } else if (data.mimeType) {
        setViewerFile({ type: "image", content: data.content, mimeType: data.mimeType, path });
      } else {
        setViewerFile({ type: "code", content: data.content, language: data.language || "plaintext", path });
      }
    } catch {
      // ignore
    }
    setFileLoading(false);
  }, [viewerFile]);

  // File delete handler
  const handleFileDelete = useCallback(async (path: string) => {
    const r = await fetch(`${BASE_URL}/studio/fs/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.error || "Delete failed");

    // If deleted file is currently viewed, close viewer
    if (viewerFile && "path" in viewerFile && viewerFile.path === path) {
      setViewerFile(null);
    }

    // Refresh tree
    const treeR = await fetch(`${BASE_URL}/studio/fs/tree?depth=2`);
    const treeData: FsNode = await treeR.json();
    setTree(treeData);
  }, [viewerFile]);

  // Tree panel resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = treeWidth;

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, TREE_WIDTH_MIN), TREE_WIDTH_MAX);
      setTreeWidth(newWidth);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [treeWidth]);

  // Keyboard: Esc closes viewer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewerFile) {
        setViewerFile(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewerFile]);

  const projectName = tree?.path?.split("/").pop() || "workspace";
  const hasViewer = viewerFile !== null;

  return (
    <div className="flex h-full">
      {/* ── Left: File tree panel ── */}
      <div
        className={[
          "relative flex h-full flex-col",
          hasViewer
            ? "border-r shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]"
            : "shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]",
        ].join(" ")}
        style={{
          background: "var(--ide-bg)",
          borderColor: "var(--card-border)",
          ...(hasViewer ? { width: treeWidth, minWidth: TREE_WIDTH_MIN, maxWidth: TREE_WIDTH_MAX } : { width: "100%" }),
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--card-border)", background: `linear-gradient(to bottom, var(--ide-header-from), var(--ide-header-to))` }}>
          <div className="flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-amber-500" fill="currentColor">
              <path d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H12.5A1.5 1.5 0 0114 5.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
            </svg>
            <div className="min-w-0">
              <h3 className="text-[11px] font-semibold truncate" style={{ color: "var(--t-secondary)" }}>
                {projectName}
              </h3>
              <p className="truncate text-[9px] leading-tight" style={{ color: "var(--t-faint)" }}>{tree?.path || WORKSPACE_ROOT}</p>
            </div>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="shrink-0 rounded p-0.5 transition-colors"
              style={{ color: "var(--t-faint)" }}
              title="탐색기 접기"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M11 4L7 8l4 4" />
                <path d="M5 3v10" />
              </svg>
            </button>
          )}
        </div>

        {/* Scrollable tree content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          {/* Workspace section */}
          <div className="flex items-center gap-1.5 px-3 py-1.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-faint)" }}>Explorer</span>
          </div>

          <div className="py-0.5">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-4">
                <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin" style={{ color: "var(--t-faint)" }}>
                  <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                </svg>
                <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>Loading...</span>
              </div>
            )}
            {error && (
              <div className="px-3 py-4 text-[10px] text-red-500 flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 111.5 0v3.5a.75.75 0 01-1.5 0V5zm.75 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                </svg>
                {error}
              </div>
            )}
            {tree && tree.children && tree.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={0}
                selectedPath={viewerFile && "path" in viewerFile ? viewerFile.path : null}
                onFileSelect={handleFileSelect}
                onLoadChildren={handleLoadChildren}
                onDelete={handleFileDelete}
              />
            ))}
          </div>

          {/* Global Config sections */}
          {GLOBAL_SECTIONS.map((section) => {
            const isExpanded = globalExpanded[section.id] ?? false;
            const sectionTree = globalTrees[section.id];

            return (
              <div key={section.id}>
                <button
                  type="button"
                  onClick={() => toggleGlobalSection(section)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 transition-colors"
                  style={{ borderTop: "1px solid var(--card-border)", background: "var(--card-bg)" }}
                  data-panel-no-drag="true"
                >
                  <svg
                    width="10" height="10" viewBox="0 0 16 16"
                    className={`shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                    style={{ color: "var(--t-faint)" }}
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                  <span className={`text-[11px] font-bold ${section.color}`}>{section.icon}</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-muted)" }}>{section.label}</span>
                  <span className="text-[9px] ml-auto" style={{ color: "var(--t-faint)" }}>~/</span>
                </button>

                {isExpanded && (
                  <div className="py-0.5">
                    {!sectionTree && (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <svg width="10" height="10" viewBox="0 0 12 12" className="animate-spin" style={{ color: "var(--t-faint)" }}>
                          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                        </svg>
                        <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>Loading...</span>
                      </div>
                    )}
                    {sectionTree?.children?.map((child) => (
                      <FileTreeNode
                        key={child.path}
                        node={child}
                        depth={0}
                        selectedPath={viewerFile && "path" in viewerFile ? viewerFile.path : null}
                        onFileSelect={handleFileSelect}
                        onLoadChildren={handleLoadChildren}
                        onDelete={handleFileDelete}
                      />
                    ))}
                    {sectionTree && (!sectionTree.children || sectionTree.children.length === 0) && (
                      <p className="px-3 py-2 text-[9px] italic" style={{ color: "var(--t-faint)" }}>(empty)</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer status bar */}
        {tree && (
          <div className="flex items-center gap-1.5 px-3 py-1" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--ide-bg)" }}>
            <span className="text-[9px]" style={{ color: "var(--t-faint)" }}>
              {tree.children?.length ?? 0} items
            </span>
          </div>
        )}

        {/* Divider resize handle — only when viewer is open */}
        {hasViewer && (
          <div
            className="absolute right-0 top-0 bottom-0 w-[3px] cursor-col-resize transition-colors hover:bg-amber-400/50 active:bg-amber-500/60 z-10"
            onMouseDown={handleResizeStart}
          />
        )}
      </div>

      {/* ── Right: File viewer panel — only rendered when a file is selected ── */}
      {hasViewer && (
        <div className="relative flex-1 flex flex-col min-w-0" style={{ background: "var(--ide-bg-alt)" }}>
          {fileLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-2 rounded-lg px-4 py-2 shadow-sm border" style={{ background: "var(--panel-bg-strong)", borderColor: "var(--border-subtle)" }}>
                <svg width="14" height="14" viewBox="0 0 12 12" className="animate-spin text-amber-500">
                  <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                </svg>
                <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Loading...</span>
              </div>
            </div>
          )}

          {viewerFile?.type === "code" && (
            <CodeViewer
              inline
              content={viewerFile.content}
              language={viewerFile.language}
              filePath={viewerFile.path}
              onClose={() => setViewerFile(null)}
              onSave={(newContent) => setViewerFile({ ...viewerFile, content: newContent })}
            />
          )}

          {viewerFile?.type === "image" && (
            <ImageViewer
              inline
              content={viewerFile.content}
              mimeType={viewerFile.mimeType}
              filePath={viewerFile.path}
              onClose={() => setViewerFile(null)}
            />
          )}

          {viewerFile?.type === "binary" && (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3" style={{ color: "var(--t-faint)" }}>
                <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <rect x="8" y="8" width="32" height="32" rx="4" />
                  <path d="M16 20h4v8h-4zM20 24h4v4h-4zM28 20h4v8h-4zM24 20h4v4h-4z" fill="currentColor" opacity="0.3" />
                </svg>
                <div className="text-center">
                  <p className="text-[12px] font-medium">바이너리 파일</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--t-faint)" }}>{viewerFile.path.split("/").pop()}</p>
                  <p className="text-[10px]" style={{ color: "var(--t-faint)" }}>{(viewerFile.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewerFile(null)}
                  className="mt-1 rounded px-3 py-1 text-[10px] font-medium transition-colors"
                  style={{ color: "var(--t-muted)", background: "var(--badge-bg)" }}
                >
                  닫기
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
