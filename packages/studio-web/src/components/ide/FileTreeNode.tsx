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

export type GitStatusMap = Record<string, "modified" | "added" | "deleted" | "renamed">;

interface FileTreeNodeProps {
  node: FsNode;
  depth: number;
  selectedPath: string | null;
  onFileSelect: (path: string) => void;
  onLoadChildren: (path: string) => Promise<FsNode>;
  onDelete?: (path: string, name: string) => Promise<void>;
  gitStatus?: GitStatusMap;
  gitRoot?: string;
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

// --- Trash icon ---
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className="text-stone-400 group-hover/del:text-red-500 transition-colors" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5" />
      <path d="M4.5 4.5l.5 8.5a1 1 0 001 1h4a1 1 0 001-1l.5-8.5" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

// --- Git status badge ---
const GIT_STATUS_STYLE: Record<string, { label: string; color: string }> = {
  modified: { label: "M", color: "text-amber-500" },
  added:    { label: "A", color: "text-emerald-500" },
  deleted:  { label: "D", color: "text-red-500" },
  renamed:  { label: "R", color: "text-sky-500" },
};

function getGitStatusForPath(
  nodePath: string,
  gitStatus: GitStatusMap | undefined,
  gitRoot: string | undefined,
): string | null {
  if (!gitStatus || !gitRoot) return null;
  // Convert absolute path to relative path from git root
  const prefix = gitRoot.endsWith("/") ? gitRoot : gitRoot + "/";
  const rel = nodePath.startsWith(prefix) ? nodePath.slice(prefix.length) : null;
  if (!rel) return null;
  return gitStatus[rel] ?? null;
}

function hasDirGitChanges(
  nodePath: string,
  gitStatus: GitStatusMap | undefined,
  gitRoot: string | undefined,
): boolean {
  if (!gitStatus || !gitRoot) return false;
  const prefix = gitRoot.endsWith("/") ? gitRoot : gitRoot + "/";
  const dirRel = nodePath.startsWith(prefix) ? nodePath.slice(prefix.length) : null;
  if (!dirRel) return false;
  const dirPrefix = dirRel.endsWith("/") ? dirRel : dirRel + "/";
  return Object.keys(gitStatus).some((key) => key.startsWith(dirPrefix));
}

export function FileTreeNode({ node, depth, selectedPath, onFileSelect, onLoadChildren, onDelete, gitStatus, gitRoot }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsNode[] | null>(node.children ?? null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isDir = node.type === "dir";
  const isSkipped = isDir && node.expandable === false;
  const isSelected = !isDir && selectedPath === node.path;
  const fileMeta = !isDir ? getFileMeta(node.name) : null;
  const fileGitStatus = !isDir ? getGitStatusForPath(node.path, gitStatus, gitRoot) : null;
  const dirHasChanges = isDir ? hasDirGitChanges(node.path, gitStatus, gitRoot) : false;
  const gitStyle = fileGitStatus ? GIT_STATUS_STYLE[fileGitStatus] : null;

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

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleConfirmDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(node.path, node.name);
    } catch {
      // parent handles error
    }
    setDeleting(false);
    setConfirmDelete(false);
  }, [onDelete, node.path, node.name]);

  const handleCancelDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  return (
    <div>
      <div className="relative group">
        <button
          type="button"
          onClick={isDir ? handleToggle : handleFileClick}
          className={[
            "flex w-full items-center gap-1 py-[3px] text-left text-[12px] leading-[18px] transition-colors duration-100",
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
          <span className={`truncate ${isDir ? "font-medium text-stone-700" : "text-stone-600"} ${gitStyle ? gitStyle.color : ""} ${dirHasChanges ? "text-amber-600" : ""}`}>
            {node.name}
          </span>
          {/* Git status badge */}
          {gitStyle && !confirmDelete && (
            <span className={`shrink-0 text-[8px] font-mono font-black ${gitStyle.color}`}>
              {gitStyle.label}
            </span>
          )}
          {dirHasChanges && (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400 opacity-60" />
          )}
          {!isDir && fileMeta && !confirmDelete && !gitStyle && (
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

        {/* Delete button — hover only, files only */}
        {onDelete && !isDir && !confirmDelete && !loading && (
          <button
            type="button"
            onClick={handleDeleteClick}
            className="group/del absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
            title={`${node.name} 삭제`}
            data-panel-no-drag="true"
          >
            <TrashIcon />
          </button>
        )}

        {/* Inline delete confirmation */}
        {confirmDelete && (
          <div
            className="absolute right-0 top-0 bottom-0 flex items-center gap-1 pr-1.5 pl-2 bg-gradient-to-l from-red-50 via-red-50/95 to-red-50/0"
            style={{ animation: "fadeIn 100ms ease-out" }}
          >
            {deleting ? (
              <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin text-red-400">
                <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
              </svg>
            ) : (
              <>
                <span className="text-[10px] text-red-600 font-medium whitespace-nowrap">삭제?</span>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
                  data-panel-no-drag="true"
                >
                  확인
                </button>
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-stone-500 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
                  data-panel-no-drag="true"
                >
                  취소
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
              onDelete={onDelete}
              gitStatus={gitStatus}
              gitRoot={gitRoot}
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

      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}
