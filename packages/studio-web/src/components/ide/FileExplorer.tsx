import { useCallback, useEffect, useRef, useState } from "react";
import { FileTreeNode, type FsNode } from "./FileTreeNode";

interface FileExplorerProps {
  onFileSelect: (path: string) => void;
  selectedPath?: string | null;
  onCollapse?: () => void;
}

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;
const INITIAL_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
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

export function FileExplorer({ onFileSelect, selectedPath, onCollapse }: FileExplorerProps) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [globalTrees, setGlobalTrees] = useState<Record<string, FsNode | null>>({});
  const [globalExpanded, setGlobalExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  const resizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, MIN_WIDTH), MAX_WIDTH);
      setWidth(newWidth);
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
  }, [width]);

  // Extract project name from path
  const projectName = tree?.path?.split("/").pop() || "workspace";

  return (
    <div
      ref={panelRef}
      className="relative flex h-full flex-col border-r border-stone-200/80 bg-stone-50 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-200/80 bg-gradient-to-b from-stone-100 to-stone-50 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-amber-500" fill="currentColor">
            <path d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H12.5A1.5 1.5 0 0114 5.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
          </svg>
          <div className="min-w-0">
            <h3 className="text-[11px] font-semibold text-stone-700 truncate">
              {projectName}
            </h3>
            <p className="truncate text-[9px] text-stone-400 leading-tight">{tree?.path || WORKSPACE_ROOT}</p>
          </div>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="shrink-0 rounded p-0.5 text-stone-400 transition-colors hover:bg-stone-200/80 hover:text-stone-600"
            title="탐색기 접기"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M11 4L7 8l4 4" />
              <path d="M5 3v10" />
            </svg>
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {/* ── Workspace section ── */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-stone-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Explorer</span>
        </div>

        <div className="py-0.5">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-4">
              <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin text-stone-300">
                <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
              </svg>
              <span className="text-[10px] text-stone-400">Loading...</span>
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
              selectedPath={selectedPath ?? null}
              onFileSelect={onFileSelect}
              onLoadChildren={handleLoadChildren}
            />
          ))}
        </div>

        {/* ── Global Config sections ── */}
        {GLOBAL_SECTIONS.map((section) => {
          const isExpanded = globalExpanded[section.id] ?? false;
          const sectionTree = globalTrees[section.id];

          return (
            <div key={section.id}>
              {/* Section header */}
              <button
                type="button"
                onClick={() => toggleGlobalSection(section)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 border-t border-stone-200/60 bg-stone-100/50 hover:bg-stone-100 transition-colors"
                data-panel-no-drag="true"
              >
                <svg
                  width="10" height="10" viewBox="0 0 16 16"
                  className={`shrink-0 transition-transform duration-150 text-stone-400 ${isExpanded ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span className={`text-[11px] font-bold ${section.color}`}>{section.icon}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">{section.label}</span>
                <span className="text-[9px] text-stone-400 ml-auto">~/</span>
              </button>

              {/* Section tree */}
              {isExpanded && (
                <div className="py-0.5 bg-stone-50/50">
                  {!sectionTree && (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <svg width="10" height="10" viewBox="0 0 12 12" className="animate-spin text-stone-300">
                        <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
                      </svg>
                      <span className="text-[9px] text-stone-400">Loading...</span>
                    </div>
                  )}
                  {sectionTree?.children?.map((child) => (
                    <FileTreeNode
                      key={child.path}
                      node={child}
                      depth={0}
                      selectedPath={selectedPath ?? null}
                      onFileSelect={onFileSelect}
                      onLoadChildren={handleLoadChildren}
                    />
                  ))}
                  {sectionTree && (!sectionTree.children || sectionTree.children.length === 0) && (
                    <p className="px-3 py-2 text-[9px] text-stone-400 italic">(empty)</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer status bar */}
      {tree && (
        <div className="flex items-center gap-1.5 border-t border-stone-100 bg-stone-50 px-3 py-1">
          <span className="text-[9px] text-stone-400">
            {tree.children?.length ?? 0} items
          </span>
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-[3px] cursor-col-resize transition-colors hover:bg-amber-400/50 active:bg-amber-500/60"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
