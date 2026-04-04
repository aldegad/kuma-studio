import { useState, useCallback } from "react";

export interface FsNode {
  name: string;
  path: string;
  type: "file" | "dir";
  hidden?: boolean;
  expandable?: boolean;
  children?: FsNode[];
  size?: number;
}

interface FileTreeNodeProps {
  node: FsNode;
  depth: number;
  selectedPath: string | null;
  onFileSelect: (path: string) => void;
  onLoadChildren: (path: string) => Promise<FsNode>;
}

// --- SVG-style icon colors by extension ---
const EXT_META: Record<string, { label: string; color: string }> = {
  ts:   { label: "TS", color: "text-blue-600" },
  tsx:  { label: "TX", color: "text-blue-500" },
  js:   { label: "JS", color: "text-yellow-600" },
  jsx:  { label: "JX", color: "text-yellow-500" },
  json: { label: "{}", color: "text-emerald-600" },
  md:   { label: "M",  color: "text-stone-500" },
  html: { label: "<>", color: "text-orange-500" },
  css:  { label: "#",  color: "text-purple-500" },
  py:   { label: "Py", color: "text-sky-600" },
  sh:   { label: "$",  color: "text-lime-600" },
  yml:  { label: "Y",  color: "text-rose-500" },
  yaml: { label: "Y",  color: "text-rose-500" },
  png:  { label: "Im", color: "text-teal-500" },
  jpg:  { label: "Im", color: "text-teal-500" },
  jpeg: { label: "Im", color: "text-teal-500" },
  gif:  { label: "Im", color: "text-teal-500" },
  svg:  { label: "Sv", color: "text-amber-500" },
  webp: { label: "Im", color: "text-teal-500" },
};

function getFileMeta(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return EXT_META[ext] || { label: "F", color: "text-stone-400" };
}

// --- Chevron SVG ---
function ChevronIcon({ expanded, muted }: { expanded: boolean; muted?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""} ${muted ? "text-stone-300" : "text-stone-400"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

// --- Folder SVG icon ---
function FolderIcon({ open, skipped }: { open: boolean; skipped?: boolean }) {
  if (skipped) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-stone-300" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="2" y="3" width="12" height="10" rx="1.5" strokeDasharray="2 1.5" />
      </svg>
    );
  }
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-amber-500" fill="currentColor">
        <path d="M1.5 3.5A1.5 1.5 0 013 2h3.586a1 1 0 01.707.293L8.5 3.5H13a1.5 1.5 0 011.5 1.5v.5H3.5a2 2 0 00-1.94 1.515L1 9.5V5A1.5 1.5 0 012.5 3.5H1.5z" />
        <path d="M1.06 7.015A1.5 1.5 0 012.56 6H13.44a1.5 1.5 0 011.5 1.015l-.94 5A1.5 1.5 0 0112.56 13H3.44a1.5 1.5 0 01-1.44-1.015l-.94-4.97z" opacity="0.85" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-amber-500" fill="currentColor">
      <path d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H12.5A1.5 1.5 0 0114 5.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
    </svg>
  );
}

// --- File SVG icon ---
function FileIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={`shrink-0 ${color}`} fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M4.5 1.5h5l3 3v9.5a1 1 0 01-1 1h-7a1 1 0 01-1-1v-11.5a1 1 0 011-1z" />
      <path d="M9.5 1.5v3h3" />
    </svg>
  );
}

export function FileTreeNode({ node, depth, selectedPath, onFileSelect, onLoadChildren }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsNode[] | null>(node.children ?? null);
  const [loading, setLoading] = useState(false);

  const isDir = node.type === "dir";
  const isSkipped = isDir && node.expandable === false;
  const isSelected = !isDir && selectedPath === node.path;
  const fileMeta = !isDir ? getFileMeta(node.name) : null;

  const handleToggle = useCallback(async () => {
    if (!isDir) return;

    if (isSkipped) {
      window.open(`file://${node.path}`);
      return;
    }

    if (!expanded && (children === null || children.length === 0)) {
      setLoading(true);
      try {
        const result = await onLoadChildren(node.path);
        setChildren(result.children ?? []);
      } catch {
        setChildren([]);
      }
      setLoading(false);
    }

    setExpanded((v) => !v);
  }, [isDir, isSkipped, expanded, children, node.path, onLoadChildren]);

  const handleFileClick = useCallback(() => {
    if (!isDir) {
      onFileSelect(node.path);
    }
  }, [isDir, node.path, onFileSelect]);

  return (
    <div>
      <button
        type="button"
        onClick={isDir ? handleToggle : handleFileClick}
        className={[
          "group flex w-full items-center gap-1 py-[3px] text-left text-[12px] leading-[18px] transition-colors duration-100",
          node.hidden ? "opacity-50" : "",
          isSkipped ? "text-gray-400" : "",
          isSelected
            ? "bg-amber-50 border-l-2 border-amber-400"
            : "border-l-2 border-transparent hover:bg-stone-100",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 14 + (isSelected ? 6 : 8)}px` }}
        data-panel-no-drag="true"
      >
        {isDir ? (
          <>
            <ChevronIcon expanded={expanded} muted={isSkipped} />
            <FolderIcon open={expanded} skipped={isSkipped} />
          </>
        ) : (
          <>
            <span className="w-4 shrink-0" />
            <FileIcon color={fileMeta?.color || "text-stone-400"} />
          </>
        )}
        <span className={`truncate ${isDir ? "font-medium text-stone-700" : "text-stone-600"}`}>
          {node.name}
        </span>
        {!isDir && fileMeta && (
          <span className={`ml-auto mr-2 shrink-0 text-[9px] font-mono font-semibold ${fileMeta.color} opacity-0 group-hover:opacity-60 transition-opacity`}>
            {fileMeta.label}
          </span>
        )}
        {loading && (
          <span className="ml-auto mr-2 shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin text-stone-400">
              <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </button>

      {isDir && expanded && children && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
              onLoadChildren={onLoadChildren}
            />
          ))}
          {children.length === 0 && (
            <p
              className="py-1 text-[10px] text-stone-300 italic"
              style={{ paddingLeft: `${(depth + 1) * 14 + 24}px` }}
            >
              (empty)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
